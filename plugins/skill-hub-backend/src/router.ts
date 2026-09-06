import {
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { CatalogService } from '@backstage/plugin-catalog-node';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  ANNOTATION_ASSET_PATH,
  ANNOTATION_BODY_PATH,
  ANNOTATION_COMMIT,
  ANNOTATION_REPO,
  readEvalScore,
} from '@internal/plugin-skill-hub-common';
import express from 'express';
import { Octokit } from '@octokit/rest';
import { SkillHubStatusService } from './status';
import { ReceiptQueue } from './receipts/ReceiptQueue';

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/;

/**
 * The part of a file a person actually reads.
 *
 * A SKILL.md opens with YAML frontmatter, and markdown renders `---\nname: x\n---`
 * as a setext heading, so leaving it in puts "name: commit description: ..." at
 * the top of the page as if it were prose. The metadata it carries is already
 * on the entity, so it is stripped rather than shown twice.
 *
 * A file that is not markdown is fenced instead, so a Python hook renders as
 * code rather than as mangled prose.
 */
export function readableBody(content: string, path: string): string {
  if (/\.(md|markdown)$/i.test(path)) {
    return content.replace(FRONTMATTER, '');
  }
  const language = path.split('.').pop()?.toLowerCase() ?? '';
  return ['```' + language, content.trimEnd(), '```'].join('\n');
}

export interface RouterOptions {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  catalog: CatalogService;
  status: SkillHubStatusService;
  receipts: ReceiptQueue;
  octokit: Octokit;
}

/**
 * Three routes, all of them about an asset the catalogue already knows.
 *
 * The body proxy exists so the GitHub token stays on the server and private
 * repositories render for a signed-in user without handing the browser a
 * credential.
 */
export async function createRouter(
  options: RouterOptions,
): Promise<express.Router> {
  const { httpAuth, catalog, status, receipts, octokit, logger } = options;
  const router = express.Router();
  router.use(express.json());

  router.get('/status', async (req, res) => {
    await httpAuth.credentials(req, { allow: ['user', 'service'] });
    res.json({ provider: status.get(), receipts: receipts.stats() });
  });

  router.get('/assets/:entityRef/body', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const entity = await catalog.getEntityByRef(req.params.entityRef, {
      credentials,
    });
    if (!entity) {
      throw new NotFoundError(`no entity ${req.params.entityRef}`);
    }

    const repo = entity.metadata.annotations?.[ANNOTATION_REPO];
    const commit = entity.metadata.annotations?.[ANNOTATION_COMMIT];
    const path = entity.metadata.annotations?.[ANNOTATION_BODY_PATH];
    const assetPath = entity.metadata.annotations?.[ANNOTATION_ASSET_PATH];
    if (!repo || !commit || !path) {
      // The hand-written seed entity has no body to fetch, and neither does
      // anything imported from outside this provider. That is not an error.
      res.json({ content: null, reason: 'this asset has no fetchable body' });
      return;
    }

    // This route reads GitHub with the server's token, so what it will read
    // has to be decided here rather than by whatever wrote the annotations.
    // Anyone able to register a catalogue location can put any repository and
    // any path into an entity; without these three checks that would turn the
    // hub into a way to read private repositories through its own credential.
    //
    //   1. the repository must be one the provider actually published, which
    //      means it opted in by committing .agent-assets.yaml
    //   2. the commit must be the one the entity is pinned to, which the
    //      provider took from that repository's head
    //   3. the file must live under the asset itself
    const published = status
      .get()
      .repositories.some(r => r.repository === repo && r.state === 'published');
    const withinAsset =
      assetPath !== undefined &&
      (path === assetPath || path.startsWith(`${assetPath}/`));
    if (!published || !withinAsset || !/^[0-9a-f]{40}$/.test(commit)) {
      logger.warn(
        `refusing to read ${path} from ${repo}: the entity does not name a published asset`,
      );
      res.json({
        content: null,
        reason: 'this asset is not one the hub discovered, so its body is not served',
      });
      return;
    }

    const [owner, name] = repo.split('/');
    try {
      const response = await octokit.rest.repos.getContent({
        owner,
        repo: name,
        path,
        ref: commit,
        headers: { accept: 'application/vnd.github.raw+json' },
      });
      res.json({
        content: readableBody(response.data as unknown as string, path),
        path,
        commit,
        url: `https://github.com/${repo}/blob/${commit}/${path}`,
      });
    } catch (error) {
      logger.warn(
        `could not read ${repo}/${path} at ${commit}: ${(error as Error).message}`,
      );
      res.json({
        content: null,
        reason: `could not read ${path} from ${repo}`,
      });
    }
  });

  router.post('/receipts', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    const { entityRef, harness } = req.body ?? {};
    if (typeof entityRef !== 'string' || typeof harness !== 'string') {
      throw new InputError('entityRef and harness are required');
    }

    const entity = await catalog.getEntityByRef(entityRef, { credentials });
    // Accepted before delivery is attempted, on purpose: a receipt must never
    // be able to fail or delay a copy.
    res.status(202).json({ accepted: true });

    if (!entity) {
      logger.warn(`receipt for unknown entity ${entityRef} was discarded`);
      return;
    }
    receipts.enqueue({
      actor: credentials.principal.userEntityRef,
      entityRef,
      harness,
      commit: entity.metadata.annotations?.[ANNOTATION_COMMIT],
      verdict: readEvalScore(entity)?.verdict,
      copiedAt: new Date().toISOString(),
    });
  });

  return router;
}
