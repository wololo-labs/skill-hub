import {
  ApiBlueprint,
  PageBlueprint,
  createFrontendPlugin,
  createRouteRef,
} from '@backstage/frontend-plugin-api';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import ExtensionIcon from '@material-ui/icons/Extension';
import { SkillHubClient, skillHubApiRef } from './api';

export const rootRouteRef = createRouteRef();

/**
 * The asset page is a page extension of its own rather than a nested route
 * inside the browse page.
 *
 * Backstage's FlatRoutes gives every mounted page a `/*` suffix except one
 * mounted at `/`, which is matched exactly. Since the hub is the landing page,
 * a child route under it could never match, and an asset link pasted into
 * Slack would land on a 404. Two pages, two real paths, and a deep link works
 * from a cold browser.
 */
export const assetRouteRef = createRouteRef({
  params: ['kind', 'namespace', 'name'],
});

const skillHubApi = ApiBlueprint.make({
  name: 'skill-hub',
  params: define =>
    define({
      api: skillHubApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: deps => new SkillHubClient(deps),
    }),
});

const browsePage = PageBlueprint.make({
  name: 'browse',
  params: {
    // Overridden to `/` in app-config, so the hub is what the portal opens on.
    path: '/skill-hub',
    title: 'Skill hub',
    icon: <ExtensionIcon />,
    routeRef: rootRouteRef,
    loader: () =>
      import('./components/BrowsePage').then(m => <m.BrowsePage />),
  },
});

const assetPage = PageBlueprint.make({
  name: 'asset',
  params: {
    // No title and no icon on purpose: this page is reached from the hub, and
    // a second sidebar entry pointing at a single asset would be noise.
    path: '/asset/:kind/:namespace/:name',
    routeRef: assetRouteRef,
    loader: () => import('./components/AssetPage').then(m => <m.AssetPage />),
  },
});

/**
 * The browse, detail and install surface over whatever the entity provider
 * has discovered.
 */
export const skillHubPlugin = createFrontendPlugin({
  pluginId: 'skill-hub',
  info: { packageJson: () => import('../package.json') },
  extensions: [browsePage, assetPage, skillHubApi],
  routes: { root: rootRouteRef, asset: assetRouteRef },
});

export default skillHubPlugin;
