import {
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { CatalogService } from '@backstage/plugin-catalog-node';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  ANNOTATION_BODY_PATH,
  ANNOTATION_COMMIT,
  ANNOTATION_REPO,
  readEvalScore,
} from '@internal/plugin-skill-hub-common';
import express from 'express';
import { Octokit } from '@octokit/rest';
import { SkillHubStatusService } from './status';
import { ReceiptQueue } from './receipts/ReceiptQueue';

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
    if (!repo || !commit || !path) {
      // The hand-written seed entity has no body to fetch, and neither does
      // anything imported from outside this provider. That is not an error.
      res.json({ content: null, reason: 'this asset has no fetchable body' });
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
        content: response.data as unknown as string,
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
