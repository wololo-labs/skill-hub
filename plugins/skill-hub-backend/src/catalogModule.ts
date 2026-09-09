import {
  coreServices,
  createBackendModule,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { GithubAssetReader } from './github/GithubAssetReader';
import { createOctokit } from './github/octokit';
import { AgentAssetEntityProvider } from './provider/AgentAssetEntityProvider';
import { skillHubStatusServiceRef } from './status';

const DEFAULT_SCHEDULE = {
  frequency: { minutes: 10 },
  timeout: { minutes: 9 },
  initialDelay: { seconds: 15 },
};

/**
 * Registers the agent asset entity provider with the catalogue.
 *
 * Configuring no owners is a valid state, not a failure: the catalogue still
 * boots and still serves the hand-written entities, it just has nothing to
 * scan.
 */
export const catalogModuleSkillHub = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'skill-hub',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        status: skillHubStatusServiceRef,
      },
      async init({ catalog, config, logger, scheduler, status }) {
        const owners =
          config.getOptionalStringArray('skillHub.owners') ?? [];
        if (!owners.length) {
          logger.warn(
            'skillHub.owners is empty, so no repository will be scanned for agent assets',
          );
          return;
        }

        const schedule = config.has('skillHub.schedule')
          ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
              config.getConfig('skillHub.schedule'),
            )
          : DEFAULT_SCHEDULE;

        catalog.addEntityProvider(
          new AgentAssetEntityProvider({
            owners,
            logger,
            status,
            reader: new GithubAssetReader({
              octokit: createOctokit({ config, logger }),
              logger,
            }),
            scheduler: scheduler.createScheduledTaskRunner(schedule),
          }),
        );
        logger.info(
          `agent asset discovery is watching ${owners.join(', ')} for .agent-assets.yaml`,
        );
      },
    });
  },
});
