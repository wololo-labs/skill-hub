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
import { RepositoryStatus, SkillHubStatusService } from './status';
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
 * Headings are pushed down one level, because the page already has an h1 with
 * the asset's name on it. Without this a document's own title is a second h1
 * and the page has no single heading, which is exactly the shape a screen
 * reader cannot navigate.
 *
 * A file that is not markdown is fenced instead, so a Python hook renders as
 * code rather than as mangled prose.
 */
export function readableBody(content: string, path: string): string {
  if (/\.(md|markdown)$/i.test(path)) {
    return demoteHeadings(content.replace(FRONTMATTER, ''));
  }
  const language = path.split('.').pop()?.toLowerCase() ?? '';
  return ['```' + language, content.trimEnd(), '```'].join('\n');
}

/**
 * Pushes every ATX heading down one level, leaving h6 where it is because
 * there is nothing below it. Fenced code is left alone: a `#` at the start of
 * a line inside a shell block is a comment, not a heading.
 */
function demoteHeadings(markdown: string): string {
  let fenced = false;
  return markdown
    .split('\n')
    .map(line => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      const heading = /^(#{1,5})(\s+\S)/.exec(line);
      return heading ? `#${line}` : line;
    })
    .join('\n');
}

export interface BodyRequest {
  repo: string;
  commit: string;
  path: string;
  assetPath?: string;
}

/**
 * Decides what the body route is allowed to read, before it reads it.
 *
 * This route uses the server's GitHub token, so the decision cannot be left to
 * whatever wrote the annotations. Anyone who can register a catalogue location
 * can put any repository and any path on an entity, and without these checks
 * that would turn the hub into a way to read a private repository through its
 * own credential.
 *
 *   1. the repository must be one the provider actually published, which means
 *      it opted in by committing .agent-assets.yaml
 *   2. the commit must look like the full sha the provider pins to
 *   3. the file must live under the asset's own path
 *
 * Returns the reason for a refusal, or undefined to allow the read.
 */
export function refuseUnlessPublished(
  request: BodyRequest,
  repositories: RepositoryStatus[],
): string | undefined {
  const published = repositories.some(
    r => r.repository === request.repo && r.state === 'published',
  );
  if (!published) {
    return 'the repository is not one the provider published';
  }
  if (!/^[0-9a-f]{40}$/.test(request.commit)) {
    return 'the commit is not a full sha';
  }
  const { assetPath, path } = request;
  if (
    assetPath === undefined ||
    !(path === assetPath || path.startsWith(`${assetPath}/`))
  ) {
    return 'the file is outside the asset it belongs to';
  }
  return undefined;
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

    const refusal = refuseUnlessPublished(
      { repo, commit, path, assetPath },
      status.get().repositories,
    );
    if (refusal) {
      logger.warn(`refusing to read ${path} from ${repo}: ${refusal}`);
      res.json({
        content: null,
        reason:
          'this asset is not one the hub discovered, so its body is not served',
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
