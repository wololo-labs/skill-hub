import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import skillHubPlugin from '@internal/plugin-skill-hub';
import { authModule } from './modules/auth';
import { navModule } from './modules/nav';
import { themeModule } from './modules/theme';
import { homeModule } from './modules/home';

export default createApp({
  features: [
    catalogPlugin,
    skillHubPlugin,
    authModule,
    themeModule,
    navModule,
    homeModule,
  ],
});
