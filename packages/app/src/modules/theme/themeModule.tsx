import { UnifiedThemeProvider } from '@backstage/theme';
import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { ThemeBlueprint } from '@backstage/plugin-app-react';
import LightIcon from '@material-ui/icons/WbSunny';
import DarkIcon from '@material-ui/icons/Brightness2';
import { skillHubDark, skillHubLight } from './skillHubTheme';

/**
 * Light is the default. The primary act on this surface is reading an asset
 * body and weighing a score, usually on a shared screen, and both of those go
 * better on a light ground. Dark is a first-class alternative rather than an
 * afterthought: every token is verified against its own background.
 */
const lightTheme = ThemeBlueprint.make({
  name: 'skill-hub-light',
  params: {
    theme: {
      id: 'skill-hub-light',
      title: 'Light',
      variant: 'light',
      icon: <LightIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={skillHubLight} children={children} />
      ),
    },
  },
});

const darkTheme = ThemeBlueprint.make({
  name: 'skill-hub-dark',
  params: {
    theme: {
      id: 'skill-hub-dark',
      title: 'Dark',
      variant: 'dark',
      icon: <DarkIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={skillHubDark} children={children} />
      ),
    },
  },
});

export const themeModule = createFrontendModule({
  pluginId: 'app',
  extensions: [lightTheme, darkTheme],
});
