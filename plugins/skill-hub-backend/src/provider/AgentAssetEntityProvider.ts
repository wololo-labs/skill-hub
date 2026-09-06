import { LoggerService, SchedulerServiceTaskRunner } from '@backstage/backend-plugin-api';
import { Entity } from '@backstage/catalog-model';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { GithubAssetReader, RepoRef } from '../github/GithubAssetReader';
import { SkillHubStatus, SkillHubStatusService, RepositoryStatus } from '../status';
import { buildEntities, publishedPaths } from './entities';
import { ManifestError, parseManifest } from './manifest';

/**
 * How many repositories are checked at once. Eight keeps a several hundred
 * repository scan inside its schedule without going near GitHub's secondary
 * rate limits, which start to bite on concurrent bursts rather than on
 * sustained volume.
 */
const SCAN_CONCURRENCY = 8;

/** How many asset bodies are read at once from a single repository. */
const READ_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface AgentAssetEntityProviderOptions {
  owners: string[];
  reader: GithubAssetReader;
  logger: LoggerService;
  scheduler: SchedulerServiceTaskRunner;
  status: SkillHubStatusService;
}

/**
 * Discovers agent assets by manifest.
 *
 * A repository joins the catalogue by adding `.agent-assets.yaml` to its root
 * and leaves by removing it. Every sync applies a full mutation, which makes
 * the provider authoritative for what it emitted: an asset that stops being
 * published stops existing here on the next run, with no tombstone to write.
 */
export class AgentAssetEntityProvider implements EntityProvider {
  readonly #options: AgentAssetEntityProviderOptions;
  #connection?: EntityProviderConnection;

  constructor(options: AgentAssetEntityProviderOptions) {
    this.#options = options;
  }

  getProviderName(): string {
    return 'skill-hub:agent-assets';
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.#connection = connection;
    await this.#options.scheduler.run({
      id: 'skill-hub:agent-assets:refresh',
      fn: async () => {
        try {
          await this.refresh();
        } catch (error) {
          // A failed run must not take the scheduler down with it. The error
          // is recorded so the status route can show it.
          this.#options.logger.error(
            `agent asset sync failed: ${(error as Error).message}`,
          );
          this.#options.status.set({
            ...this.#options.status.get(),
            lastRunFinishedAt: new Date().toISOString(),
            lastRunError: (error as Error).message,
          });
        }
      },
    });
  }

  async refresh(): Promise<void> {
    if (!this.#connection) {
      throw new Error('skill-hub provider is not connected');
    }
    const { owners, reader, logger, status } = this.#options;
    const startedAt = Date.now();

    const entities: Entity[] = [];
    const repositories: RepositoryStatus[] = [];
    let scanned = 0;

    for (const owner of owners) {
      let repos: RepoRef[];
      try {
        repos = await reader.listRepositories(owner);
      } catch (error) {
        logger.error(
          `could not list repositories for ${owner}: ${(error as Error).message}`,
        );
        repositories.push({
          repository: owner,
          state: 'error',
          error: `could not list repositories: ${(error as Error).message}`,
        });
        continue;
      }

      const live = repos.filter(repo => !repo.archived);
      scanned += live.length;

      // One contents lookup per repository, run a few at a time. An estate
      // of several hundred repositories is mostly 404s, and doing them one
      // after another is what would put a scan outside its schedule.
      const results = await mapWithConcurrency(live, SCAN_CONCURRENCY, async repo => {
        const name = `${repo.owner}/${repo.repo}`;
        try {
          const manifest = await reader.getManifest(repo);
          // No manifest is the common case and the whole point of the design:
          // a repository is invisible until it opts in.
          if (!manifest) return undefined;

          const parsed = parseManifest(manifest.raw);
          const tree = await reader.getTree(repo, manifest.commitSha);
          const byPath = new Map(tree.map(e => [e.path, e.sha]));

          // Warm the blob cache first. A repository publishing a hundred
          // skills is a hundred reads, and doing them inside the build one at
          // a time is what would make a single repository dominate a sync.
          await mapWithConcurrency(
            publishedPaths(
              parsed,
              tree.filter(e => e.type === 'blob').map(e => e.path),
            ),
            READ_CONCURRENCY,
            async path => {
              const sha = byPath.get(path);
              if (sha) await reader.readBlob(repo, sha);
            },
          );

          const built = await buildEntities({
            repo,
            commitSha: manifest.commitSha,
            manifest: parsed,
            tree,
            read: async path => {
              const sha = byPath.get(path);
              if (!sha) throw new Error(`no blob at ${path}`);
              return reader.readBlob(repo, sha);
            },
          });

          if (built.collisions.length) {
            logger.warn(
              `${name} publishes ${built.collisions.length} duplicate names, the first match of each was kept: ${built.collisions
                .slice(0, 5)
                .join(', ')}`,
            );
          }
          logger.info(
            `${name} published ${built.entities.length} entities at ${manifest.commitSha.slice(0, 8)}`,
          );
          return {
            entities: built.entities,
            status: {
              repository: name,
              state: 'published' as const,
              commit: manifest.commitSha,
              assets: built.counts,
              entityCount: built.entities.length,
            },
          };
        } catch (error) {
          // One repository never takes the sync down. A malformed manifest
          // gets one clear line and the repository is skipped.
          const message =
            error instanceof ManifestError
              ? `.agent-assets.yaml is not usable: ${error.message}`
              : (error as Error).message;
          logger.error(`skipping ${name}: ${message}`);
          return {
            entities: [],
            status: { repository: name, state: 'error' as const, error: message },
          };
        }
      });

      for (const result of results) {
        if (!result) continue;
        entities.push(...result.entities);
        repositories.push(result.status);
      }
    }

    await this.#connection.applyMutation({
      type: 'full',
      entities: entities.map(entity => ({
        entity,
        locationKey: this.getProviderName(),
      })),
    });

    const finishedAt = Date.now();
    const next: SkillHubStatus = {
      lastRunStartedAt: new Date(startedAt).toISOString(),
      lastRunFinishedAt: new Date(finishedAt).toISOString(),
      lastRunDurationMs: finishedAt - startedAt,
      owners,
      repositoriesScanned: scanned,
      entityCount: entities.length,
      repositories,
    };
    status.set(next);
    logger.info(
      `agent asset sync finished: ${entities.length} entities from ${
        repositories.filter(r => r.state === 'published').length
      } of ${scanned} repositories in ${finishedAt - startedAt}ms`,
    );
  }
}
