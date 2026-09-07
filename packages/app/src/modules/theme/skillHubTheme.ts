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

/**
 * One focus ring, used everywhere. Two pixels of the primary at an offset,
 * which clears 3:1 against every surface it lands on in both themes.
 */
const focusRing = (t: Tokens) => ({
  outline: `2px solid ${t.primary}`,
  outlineOffset: '2px',
  borderRadius: '3px',
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
      // The badge reads its pass ink from here: status.ok on the highlight
      // surface is 4.4:1, which misses AA at badge size, so a darker step of
      // the same ramp carries the text at 7.4:1.
      infoText: t.okInk,
      errorBackground: t.okSurface,
      warningBackground: t.okSurface,
      infoBackground: t.okSurface,
      errorText: t.error,
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
          // A keyboard user must always be able to see where they are. Scoped
          // to :focus-visible so a mouse click never paints a ring.
          //
          // This global alone is not enough. Material UI v4's ButtonBase sets
          // `outline: 0` on its own root class, which ties on specificity and
          // wins on source order, so every button would focus invisibly. The
          // component override below is what actually reaches them.
          '*:focus-visible': focusRing(t),
        },
      },
      MuiButtonBase: {
        styleOverrides: {
          root: { '&:focus-visible': focusRing(t) },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            letterSpacing: 0,
            '&:focus-visible': focusRing(t),
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { '&:focus-visible': focusRing(t) },
        },
      },
      MuiLink: {
        styleOverrides: {
          root: { '&:focus-visible': focusRing(t) },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: { '&:focus-within': focusRing(t) },
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
      BackstageMarkdownContent: {
        styleOverrides: {
          // The markdown renderer highlights code with a fixed dark palette
          // written as inline styles, so it survives a theme change and it
          // fails contrast: its comment colour measures 2.2:1 on its own
          // background. Inline styles can only be beaten with !important.
          //
          // Every token is neutralised to the code ink first, then the two
          // roles worth keeping are re-coloured from verified values. A
          // language this renderer highlights differently therefore degrades
          // to readable rather than to unreadable.
          markdown: {
            // The renderer wraps a highlighted block as pre > div > pre and
            // puts its own surface, padding and scroll container on the inner
            // one as inline styles. Only the inner element can be trusted to
            // be the code surface, and only !important reaches it.
            '& pre': {
              background: t.codeSurface,
              color: t.codeInk,
              border: `1px solid ${t.border}`,
              borderRadius: 6,
              padding: '12px 14px',
              overflowX: 'auto',
              margin: '16px 0',
            },
            // When there is an inner block, the outer one is a pass-through
            // rather than a second box around the first.
            '& pre:has(pre)': {
              background: 'transparent',
              border: 'none',
              padding: 0,
              overflow: 'visible',
            },
            '& pre pre': {
              background: `${t.codeSurface} !important`,
              color: `${t.codeInk} !important`,
              border: `1px solid ${t.border} !important`,
              borderRadius: '6px !important',
              padding: '12px 14px !important',
              margin: '0 !important',
              display: 'block !important',
              overflowX: 'auto !important',
            },
            // Every token is neutralised to the code ink, then the two roles
            // worth keeping are re-coloured from verified values. A language
            // this renderer highlights differently therefore degrades to
            // readable rather than to unreadable.
            '& pre span': { color: `${t.codeInk} !important` },
            '& pre [style*="rgb(119, 119, 119)"], & pre [style*="rgb(64, 128, 128)"]':
              {
                color: `${t.codeComment} !important`,
                fontStyle: 'italic',
              },
            '& pre [style*="rgb(221, 136, 136)"], & pre [style*="rgb(186, 33, 33)"], & pre [style*="rgb(33, 145, 97)"], & pre [style*="rgb(0, 134, 179)"]':
              {
                color: `${t.codeLiteral} !important`,
              },
            // Inline code in prose, not a block.
            '& code': {
              backgroundColor: t.codeSurface,
              color: t.codeInk,
              padding: '1px 4px',
              borderRadius: 3,
            },
            '& pre code': {
              backgroundColor: 'transparent',
              padding: 0,
            },
          },
        },
      },
    },
  });
}

export const skillHubLight = build(light, 'light');
export const skillHubDark = build(dark, 'dark');
