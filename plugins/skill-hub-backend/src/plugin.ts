import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { createOctokit } from './github/octokit';
import { ReceiptQueue } from './receipts/ReceiptQueue';
import { createRouter } from './router';
import { skillHubStatusServiceRef } from './status';

/**
 * The skill-hub HTTP surface: provider status, asset bodies, install receipts.
 */
/** An empty configured value means the operator left it blank, so: absent. */
function optionalText(
  config: { getOptional(key: string): unknown } | undefined,
  key: string,
): string | undefined {
  const value = config?.getOptional(key);
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export const skillHubPlugin = createBackendPlugin({
  pluginId: 'skill-hub',
  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        lifecycle: coreServices.rootLifecycle,
        catalog: catalogServiceRef,
        status: skillHubStatusServiceRef,
      },
      async init({
        logger,
        config,
        httpAuth,
        httpRouter,
        lifecycle,
        catalog,
        status,
      }) {
        // Both halves have to be present. An empty environment variable
        // leaves the key in place with no value, so an unconfigured Mission
        // Control must read as absent rather than as a startup failure.
        const missionControl = config.getOptionalConfig(
          'skillHub.missionControl',
        );
        // Read through a tolerant helper: an empty value is absent, not a
        // string of length zero. Compose cannot omit an environment variable,
        // so an unconfigured Receipt service arrives as '' rather than unset.
        const baseUrl = optionalText(missionControl, 'baseUrl');
        const token = optionalText(missionControl, 'token');
        const receipts = new ReceiptQueue({
          logger,
          config: baseUrl && token ? { baseUrl, token } : undefined,
        });
        lifecycle.addShutdownHook(() => receipts.shutdown());

        httpRouter.use(
          await createRouter({
            logger,
            httpAuth,
            catalog,
            status,
            receipts,
            octokit: createOctokit({ config, logger }),
          }),
        );
      },
    });
  },
});
