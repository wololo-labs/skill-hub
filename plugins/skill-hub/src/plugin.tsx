import {
  ApiBlueprint,
  PageBlueprint,
  createFrontendPlugin,
  createRouteRef,
} from '@backstage/frontend-plugin-api';
import {
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import ExtensionIcon from '@material-ui/icons/Extension';
import { SkillHubClient, skillHubApiRef } from './api';

export const rootRouteRef = createRouteRef();

const skillHubApi = ApiBlueprint.make({
  name: 'skill-hub',
  params: define =>
    define({
      api: skillHubApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: deps => new SkillHubClient(deps),
    }),
});

const skillHubPage = PageBlueprint.make({
  params: {
    // Overridden in app-config so the hub is the landing page.
    path: '/skill-hub',
    title: 'Skill hub',
    icon: <ExtensionIcon />,
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/SkillHubRouter').then(m => <m.SkillHubRouter />),
  },
});

/**
 * The browse, detail and install surface over whatever the entity provider
 * has discovered.
 */
export const skillHubPlugin = createFrontendPlugin({
  pluginId: 'skill-hub',
  info: { packageJson: () => import('../package.json') },
  extensions: [skillHubPage, skillHubApi],
  routes: { root: rootRouteRef },
});

export default skillHubPlugin;
