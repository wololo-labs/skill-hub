/**
 * The hub's palette.
 *
 * Two rules produced every value here.
 *
 * The chrome is achromatic. Every neutral is chroma exactly 0, with no warm or
 * cool tint, so nothing in the frame competes with the one thing this product
 * exists to communicate: whether an asset has been measured. Colour is spent on
 * state and on nothing else.
 *
 * Every pair is verified, not eyeballed. The OKLCH source is kept beside each
 * hex so the ramp can be re-derived rather than nudged, and the contrast ratio
 * against the surface the value is actually used on is recorded next to it.
 * Body text clears 4.5:1 and most of it clears 7:1, in both themes.
 */

export interface Tokens {
  bg: string;
  paper: string;
  ink: string;
  subtle: string;
  border: string;
  primary: string;
  primaryDark: string;
  link: string;
  linkHover: string;
  ok: string;
  okInk: string;
  okSurface: string;
  error: string;
  warning: string;
  codeSurface: string;
  codeInk: string;
  codeComment: string;
  codeLiteral: string;
  navBg: string;
  navInk: string;
  navSelected: string;
  navHover: string;
}

export const light: Tokens = {
  // oklch(0.985 0 0) / oklch(1 0 0)
  bg: '#FAFAFA',
  paper: '#FFFFFF',
  // oklch(0.240 0 0), 16.5:1 on paper
  ink: '#1F1F1F',
  // oklch(0.500 0 0), 6.0:1 on paper
  subtle: '#636363',
  // oklch(0.895 0 0)
  border: '#DCDCDC',
  // oklch(0.500 0.130 232), 5.6:1 on paper. Deep petrol rather than a bright
  // interface blue: it marks selection and focus, it is not an invitation.
  primary: '#006EA0',
  primaryDark: '#00567C',
  // oklch(0.480 0.135 232), 6.1:1 on paper
  link: '#00689C',
  linkHover: '#004E77',
  // oklch(0.520 0.130 155), 5.2:1 on paper
  ok: '#007E46',
  okInk: '#00582C',
  okSurface: '#DBF4E3',
  // oklch(0.520 0.180 27), 6.1:1 on paper
  error: '#BA2B28',
  // oklch(0.560 0.130 70), 4.8:1 on paper
  warning: '#A46400',
  // The markdown renderer ships a fixed dark code block whose comment colour
  // is 2.2:1. These replace it. oklch(0.965 0 0) surface, with ink at 12.2:1,
  // comments at 5.3:1 and literals at 6.6:1.
  codeSurface: '#F3F3F3',
  codeInk: '#2E2E2E',
  codeComment: '#56695C',
  codeLiteral: '#963633',
  navBg: '#171717',
  navInk: '#B7B7B7',
  navSelected: '#F8F8F8',
  navHover: '#262626',
};

export const dark: Tokens = {
  // oklch(0.165 0 0) / oklch(0.215 0 0)
  bg: '#0E0E0E',
  paper: '#191919',
  // oklch(0.945 0 0), 15.0:1 on paper
  ink: '#EDEDED',
  // oklch(0.740 0 0), 7.7:1 on paper
  subtle: '#ABABAB',
  // oklch(0.320 0 0)
  border: '#333333',
  // oklch(0.780 0.110 232), 9.0:1 on paper
  primary: '#67C4F2',
  primaryDark: '#8FD4F6',
  // oklch(0.800 0.105 232), 9.6:1 on paper
  link: '#72CAF6',
  linkHover: '#A2DDF9',
  // oklch(0.790 0.145 155), 9.7:1 on paper
  ok: '#62D691',
  okInk: '#8DF1B2',
  okSurface: '#133621',
  // oklch(0.700 0.160 27), 6.1:1 on paper
  error: '#F27166',
  // oklch(0.800 0.130 70), 9.2:1 on paper
  warning: '#F3AE58',
  // oklch(0.235 0 0) surface, ink 12.4:1, comments 6.3:1, literals 7.4:1.
  codeSurface: '#1E1E1E',
  codeInk: '#DEDEDE',
  codeComment: '#90A496',
  codeLiteral: '#EF958E',
  navBg: '#141414',
  navInk: '#ABABAB',
  navSelected: '#F8F8F8',
  navHover: '#242424',
};
