/*
 * skill-hub backend.
 *
 * Deliberately smaller than the create-app default: the hub is a catalogue and
 * an install surface, so the scaffolder, techdocs and kubernetes plugins are
 * not installed. Everything left here is either serving the app, holding the
 * catalogue, or answering the skill-hub plugin.
 */

import { createBackend } from '@backstage/backend-defaults';
import skillHubPlugin, {
  authModuleGuestGuard,
  catalogModuleSkillHub,
} from '@internal/plugin-skill-hub-backend';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// auth plugin. Guest stays available so a clean clone boots without an OAuth
// app; the GitHub provider takes over as soon as a client id is configured.
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
// Guest is only tolerable while the hub is on localhost, so that is enforced
// rather than documented: see guestGuard.ts.
backend.add(authModuleGuestGuard);
backend.add(import('@backstage/plugin-auth-backend-module-github-provider'));

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));
// kind AiResource plus the API/mcp-server spec type, which is what every agent
// asset in this catalogue is modelled as.
backend.add(import('@backstage/plugin-catalog-backend-module-ai-model'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
backend.add(
  import('@backstage/plugin-permission-backend-module-allow-all-policy'),
);

// search plugin
backend.add(import('@backstage/plugin-search-backend'));
backend.add(import('@backstage/plugin-search-backend-module-pg'));
backend.add(import('@backstage/plugin-search-backend-module-catalog'));

// user settings plugin
backend.add(import('@backstage/plugin-user-settings-backend'));

// notifications and signals plugins
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));

// skill-hub: the agent asset entity provider, the asset body proxy and the
// Receipt service receipt queue.
backend.add(catalogModuleSkillHub);
backend.add(skillHubPlugin);

backend.start();
