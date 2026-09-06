import { UnifiedTheme, createUnifiedTheme } from '@backstage/theme';
import { Tokens, dark, light } from './tokens';

/**
 * A product type scale, not a marketing one: fixed rem steps at a 1.2 ratio,
 * one family in several weights. Headings here label panels and pages, they
 * never perform, so nothing is fluid and nothing is display sized.
 */
const FONT_FAMILY = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

const heading = (fontSize: string, fontWeight: number, marginBottom: number) => ({
  fontFamily: FONT_FAMILY,
  fontSize,
  fontWeight,
  marginBottom,
  letterSpacing: '-0.011em',
});

const flat = (t: Tokens) => ({
  colors: [t.paper],
  shape: 'none',
  backgroundImage: 'none',
  fontColor: t.ink,
});

function build(t: Tokens, mode: 'light' | 'dark'): UnifiedTheme {
  return createUnifiedTheme({
    fontFamily: FONT_FAMILY,
    typography: {
      htmlFontSize: 16,
      fontFamily: FONT_FAMILY,
      h1: heading('2.074rem', 600, 12),
      h2: heading('1.728rem', 600, 12),
      h3: heading('1.44rem', 600, 10),
      h4: heading('1.2rem', 600, 10),
      h5: heading('1rem', 600, 8),
      h6: heading('0.875rem', 600, 8),
    },
    palette: {
      type: mode,
      mode,
      background: { default: t.bg, paper: t.paper },
      text: { primary: t.ink, secondary: t.subtle },
      primary: { main: t.primary, dark: t.primaryDark },
      secondary: { main: t.primary },
      divider: t.border,
      error: { main: t.error },
      warning: { main: t.warning },
      success: { main: t.ok },
      info: { main: t.primary },
      status: {
        ok: t.ok,
        warning: t.warning,
        error: t.error,
        running: t.primary,
        pending: t.warning,
        aborted: t.subtle,
      },
      banner: {
        info: t.primary,
        error: t.error,
        warning: t.warning,
        text: t.paper,
        link: t.paper,
        closeButtonColor: t.paper,
      },
      bursts: {
        fontColor: t.paper,
        slackChannelText: t.subtle,
        backgroundColor: { default: t.primary },
        gradient: { linear: `linear-gradient(0deg, ${t.primary}, ${t.primary})` },
      },
      border: t.border,
      textContrast: t.ink,
      textVerySubtle: t.border,
      textSubtle: t.subtle,
      highlight: t.okSurface,
      errorBackground: t.okSurface,
      warningBackground: t.okSurface,
      infoBackground: t.okSurface,
      errorText: t.error,
      infoText: t.primary,
      warningText: t.warning,
      link: t.link,
      linkHover: t.linkHover,
      gold: t.warning,
      navigation: {
        background: t.navBg,
        indicator: t.primary,
        color: t.navInk,
        selectedColor: t.navSelected,
        navItem: { hoverBackground: t.navHover },
        submenu: { background: t.navHover },
      },
      pinSidebarButton: { icon: t.navSelected, background: t.navHover },
      tabbar: { indicator: t.primary },
    },
    defaultPageTheme: 'home',
    pageTheme: {
      // Backstage ships page headers as gradient bursts with a wave cut into
      // them. A register does not need a gradient, and a decorative shape
      // behind the asset name is exactly the sort of thing that makes a
      // sponsor stop reading, so every page here is one flat surface with a
      // rule under it.
      home: flat(t),
      tool: flat(t),
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            textRendering: 'optimizeLegibility',
          },
          // A keyboard user must always be able to see where they are. This
          // replaces the browser default rather than removing it, and it is
          // scoped to :focus-visible so a mouse click does not paint a ring.
          '*:focus-visible': {
            outline: `2px solid ${t.primary}`,
            outlineOffset: 2,
            borderRadius: 2,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 4 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          // Backstage's default elevation shadows read as a consumer app. A
          // register wants edges, so surfaces are separated by a rule.
          root: { backgroundImage: 'none' },
          elevation1: { boxShadow: 'none', border: `1px solid ${t.border}` },
          elevation2: { boxShadow: 'none', border: `1px solid ${t.border}` },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 600, minWidth: 0 },
        },
      },
      BackstageHeader: {
        styleOverrides: {
          header: {
            backgroundImage: 'none',
            backgroundColor: t.paper,
            boxShadow: 'none',
            borderBottom: `1px solid ${t.border}`,
            paddingBottom: 20,
          },
          title: { color: t.ink, fontSize: '1.5rem', fontWeight: 600 },
          subtitle: { color: t.subtle, fontSize: '0.875rem' },
          type: { color: t.subtle },
        },
      },
      BackstageHeaderLabel: {
        styleOverrides: {
          label: { color: t.subtle },
          value: { color: t.ink, fontWeight: 600 },
        },
      },
      BackstageContent: {
        styleOverrides: {
          root: { backgroundColor: t.bg },
        },
      },
    },
  });
}

export const skillHubLight = build(light, 'light');
export const skillHubDark = build(dark, 'dark');
