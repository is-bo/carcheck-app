/**
 * CarCheck design tokens.
 *
 * Source of truth for the visual system described in DESIGN.md ("The Contact Sheet").
 * Pure data, no runtime dependencies, ready for StyleSheet.create().
 * Units: layout values are dp, font sizes are sp (React Native scales them with the
 * system font size unless a component opts out via maxFontSizeMultiplier).
 */

/* ------------------------------------------------------------------ */
/* Raw palette. Components should use the role maps below, not these.  */
/* ------------------------------------------------------------------ */

export const palette = {
  ink: '#131517',
  ink2: '#454B50',
  ink3: '#646B70',
  paper: '#FFFFFF',
  paper2: '#F1F2F2',
  paper3: '#E4E7E8',
  rule: '#D3D7D9',
  outline: '#8A9196',

  cyanotype: '#1F4E96',
  cyanotypePressed: '#173B72',
  cyanotypeWash: '#E9EEF6',
  cyanotypeOnDark: '#7FA6E6',

  vermilion: '#C8321B',
  vermilionWash: '#FBEAE7',
  vermilionOnDark: '#FF6B52',
  amber: '#F0A81C',
  amberInk: '#9A5B00',

  rebate: '#0C0D0E',
  rebate2: '#1A1D1F',
  rebate3: '#2A2E31',
  rebateRule: '#3A4044',
  onRebate: '#F4F5F5',
  onRebate2: '#A3AAAE',

  white: '#FFFFFF',
  black: '#000000',
} as const;

/* ------------------------------------------------------------------ */
/* Colour roles                                                        */
/* ------------------------------------------------------------------ */

export interface ColorRoles {
  /** Screen background. */
  background: string;
  /** Grouped bands (Unfinished section, search field, signature pad). */
  surfaceTint: string;
  /** Pressed rows, disabled fills. */
  surfacePressed: string;
  text: string;
  textSecondary: string;
  /** Placeholders, counts, metadata. Never for anything the user must read to act. */
  textTertiary: string;
  /** 1 dp dividers between rows. */
  divider: string;
  /** Borders of inputs, chips, outlined controls (>= 3:1 on background). */
  outline: string;
  /** Hard rules under section headings on document-like screens. */
  ruleStrong: string;

  /** Primary action fill (ink). */
  primary: string;
  onPrimary: string;
  /** The single accent: selection, focus, progress, the binding customer action. */
  accent: string;
  accentPressed: string;
  accentWash: string;
  onAccent: string;

  /** Form and system errors (distinct role from new damage, same hue family). */
  error: string;
  errorWash: string;

  scrim: string;
  focusRing: string;
}

/** Light theme: every list, form, detail and customer screen. */
export const light: ColorRoles = {
  background: palette.paper,
  surfaceTint: palette.paper2,
  surfacePressed: palette.paper3,
  text: palette.ink,
  textSecondary: palette.ink2,
  textTertiary: palette.ink3,
  divider: palette.rule,
  outline: palette.outline,
  ruleStrong: palette.ink,

  primary: palette.ink,
  onPrimary: palette.white,
  accent: palette.cyanotype,
  accentPressed: palette.cyanotypePressed,
  accentWash: palette.cyanotypeWash,
  onAccent: palette.white,

  error: '#B42318',
  errorWash: palette.vermilionWash,

  scrim: 'rgba(12,13,14,0.48)',
  focusRing: palette.cyanotype,
};

/**
 * Rebate (film-edge black): camera, marker editor photo area, comparison, media viewer.
 * Applied regardless of system appearance because these screens are photo-centric.
 */
export const rebate: ColorRoles = {
  background: palette.rebate,
  surfaceTint: palette.rebate2,
  surfacePressed: palette.rebate3,
  text: palette.onRebate,
  textSecondary: palette.onRebate2,
  textTertiary: palette.onRebate2,
  divider: palette.rebateRule,
  // Sunlight Rule: anything tappable on the dark screens keeps a >= 3:1 boundary (about 8:1).
  outline: palette.onRebate2,
  ruleStrong: palette.onRebate,

  primary: palette.onRebate,
  onPrimary: palette.ink,
  accent: palette.cyanotypeOnDark,
  accentPressed: '#A7C3F0',
  accentWash: 'rgba(127,166,230,0.18)',
  onAccent: palette.ink,

  error: palette.vermilionOnDark,
  errorWash: 'rgba(200,50,27,0.18)',

  scrim: 'rgba(0,0,0,0.6)',
  focusRing: palette.cyanotypeOnDark,
};

/** Labels and tags laid over photos (BEFORE / AFTER, capture title). */
export const overlay = {
  tagBackground: 'rgba(12,13,14,0.78)',
  /** Light veil over a hidden (blurred) sensitive photo, under its lock glyph. */
  photoScrim: 'rgba(12,13,14,0.35)',
  tagText: palette.onRebate,
  tagTextSecondary: palette.onRebate2,
  guideStroke: palette.white,
  guideHalo: palette.rebate,
  guideFill: 'rgba(255,255,255,0.12)',
  ghostOpacityDefault: 0.4,
  ghostOpacityMax: 0.8,
} as const;

/* ------------------------------------------------------------------ */
/* Damage markers. Shape carries meaning; colour reinforces it.        */
/* ------------------------------------------------------------------ */

export type DamageStatus = 'existing' | 'new' | 'uncertain';
export type MarkerBadgeShape = 'square' | 'circle' | 'diamond';

export interface MarkerStyle {
  badgeShape: MarkerBadgeShape;
  /** true = hollow badge (white fill, coloured border). */
  hollow: boolean;
  badgeFill: string;
  badgeBorder: string;
  badgeText: string;
  /** Appended to the number, e.g. "2?" for uncertain. */
  suffix: string;
  /**
   * Badge label sequence. "letter" numbers existing (pre-rental) damage A, B, C…,
   * independent of new/uncertain. "number" numbers new and uncertain damage together
   * in one 1, 2, 3… sequence, in mark order, across both statuses.
   */
  sequence: 'letter' | 'number';
  ringCore: string;
  /** Wider stroke drawn beneath the core so the ring reads on any paint colour. */
  ringHalo: string;
  /** Solid for the ring on its own photo. */
  ringDash: readonly number[] | null;
  /** Colour for list glyphs and captions on light backgrounds. */
  uiColor: string;
  label: string;
}

export const marker: Record<DamageStatus, MarkerStyle> = {
  existing: {
    badgeShape: 'square',
    hollow: true,
    badgeFill: palette.white,
    badgeBorder: palette.ink,
    badgeText: palette.ink,
    suffix: '',
    sequence: 'letter',
    ringCore: palette.white,
    ringHalo: palette.ink,
    ringDash: null,
    uiColor: palette.ink,
    label: 'Existing',
  },
  new: {
    badgeShape: 'circle',
    hollow: false,
    badgeFill: palette.vermilion,
    badgeBorder: palette.white,
    badgeText: palette.white,
    suffix: '',
    sequence: 'number',
    ringCore: palette.vermilion,
    ringHalo: palette.white,
    ringDash: null,
    uiColor: palette.vermilion,
    label: 'New',
  },
  uncertain: {
    badgeShape: 'diamond',
    hollow: false,
    badgeFill: palette.amber,
    badgeBorder: palette.ink,
    badgeText: palette.ink,
    suffix: '?',
    sequence: 'number',
    ringCore: palette.amber,
    ringHalo: palette.ink,
    ringDash: null,
    uiColor: palette.amberInk,
    label: 'Uncertain',
  },
};

/** Geometry is in dp on screen; markers keep constant screen size at any zoom. */
export const markerGeometry = {
  badgeSize: 26,
  badgeSizeCustomer: 30,
  badgeMinThumbnail: 22,
  badgeBorder: 2.5,
  ringCore: 3,
  ringHalo: 6,
  ringMinRadius: 14,
  ringDefaultRadius: 28,
  /** Hit area around ring edge (resize) and badge (move). */
  hitSlop: 48,
  /** Badge sits on the ring at this angle (degrees, 0 = up, clockwise). */
  badgeAngle: 45,
  /** Dashed "reference" rings: new damage projected onto BEFORE, existing projected onto AFTER. */
  referenceDash: [9, 6] as const,
  loupeDiameter: 104,
  loupeMagnification: 2.4,
  loupeOffset: { x: -72, y: -88 },
} as const;

/* ------------------------------------------------------------------ */
/* Typography                                                          */
/* ------------------------------------------------------------------ */

/** Family names as registered by @expo-google-fonts/barlow and /barlow-semi-condensed. */
export const fontFamily = {
  regular: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semibold: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
  codeMedium: 'BarlowSemiCondensed_500Medium',
  codeSemibold: 'BarlowSemiCondensed_600SemiBold',
} as const;

type FontVariant = 'tabular-nums' | 'lining-nums' | 'proportional-nums';

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'none';
  fontVariant?: FontVariant[];
}

const tnum: FontVariant[] = ['tabular-nums'];

/**
 * Employee scale (ratio ~1.2). Do not set fontWeight alongside these: on Android a
 * custom family plus fontWeight falls back to the system font. Weight lives in the family.
 */
export const type = {
  /** Screen title on tab roots ("Rentals"). */
  headline: { fontFamily: fontFamily.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.2 },
  /** Sheet titles, rental detail header. */
  titleL: { fontFamily: fontFamily.semibold, fontSize: 20, lineHeight: 26 },
  /** Top bar title, step titles. */
  titleM: { fontFamily: fontFamily.semibold, fontSize: 18, lineHeight: 22 },
  /** Buttons (large) and emphasised row text. */
  titleS: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fontFamily.regular, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 16, lineHeight: 22 },
  /** Secondary row lines, helper text. */
  bodySmall: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 20 },
  /** Section headers in lists, field labels. */
  label: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 20 },
  labelSmall: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 18 },
  /** Button labels (small buttons, chips, segmented). */
  button: { fontFamily: fontFamily.semibold, fontSize: 15, lineHeight: 20 },
  buttonLarge: { fontFamily: fontFamily.semibold, fontSize: 17, lineHeight: 22 },
  caption: { fontFamily: fontFamily.medium, fontSize: 13, lineHeight: 16 },
  /** Selected navigation-bar label. */
  captionStrong: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 16 },
  /** Second line under a top-bar title ("Maria Keller · 74-XR-19"). */
  subtitle: { fontFamily: fontFamily.regular, fontSize: 14, lineHeight: 18 },
  /** Film edge code: metadata strips attached to photos only. Never a heading or eyebrow. */
  code: {
    fontFamily: fontFamily.codeMedium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontVariant: tnum,
  },
  /** Licence plate in its plate frame. Largest text on a rental row. */
  plate: { fontFamily: fontFamily.semibold, fontSize: 18, lineHeight: 20, letterSpacing: 0.9, fontVariant: tnum },
  plateSmall: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 16, letterSpacing: 0.7, fontVariant: tnum },
  /** Mileage, times, counts, prices: anything that lines up in columns. */
  numeric: { fontFamily: fontFamily.medium, fontSize: 16, lineHeight: 22, fontVariant: tnum },
  numericLarge: { fontFamily: fontFamily.semibold, fontSize: 28, lineHeight: 34, fontVariant: tnum },
  /** Marker badge numbers. */
  markerNumber: { fontFamily: fontFamily.semibold, fontSize: 14, lineHeight: 16, fontVariant: tnum },
} as const satisfies Record<string, TypeStyle>;

/** Customer hand-off mode: about 1.25x, never capped by maxFontSizeMultiplier. */
export const customerType = {
  headline: { fontFamily: fontFamily.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.2 },
  section: { fontFamily: fontFamily.semibold, fontSize: 21, lineHeight: 26 },
  body: { fontFamily: fontFamily.regular, fontSize: 19, lineHeight: 28 },
  bodyStrong: { fontFamily: fontFamily.semibold, fontSize: 19, lineHeight: 28 },
  secondary: { fontFamily: fontFamily.regular, fontSize: 17, lineHeight: 24 },
  list: { fontFamily: fontFamily.regular, fontSize: 18, lineHeight: 24 },
  button: { fontFamily: fontFamily.semibold, fontSize: 18, lineHeight: 22 },
  fine: { fontFamily: fontFamily.regular, fontSize: 15, lineHeight: 20 },
} as const satisfies Record<string, TypeStyle>;

/** Font-scale caps per context (pass as maxFontSizeMultiplier). */
export const fontScaleCap = {
  chrome: 1.3,
  body: 2,
  customer: undefined,
} as const;

/* ------------------------------------------------------------------ */
/* Space, shape, lines, touch                                          */
/* ------------------------------------------------------------------ */

export const space = {
  0: 0,
  1: 2,
  2: 4,
  3: 8,
  4: 12,
  5: 16,
  6: 20,
  7: 24,
  8: 32,
  9: 40,
  10: 48,
  11: 64,
} as const;

export const layout = {
  screenGutter: 16,
  customerGutter: 20,
  sectionGapTop: 22,
  sectionGapBottom: 6,
  rowPaddingVertical: 12,
  rowMinHeight: 72,
  appBarHeight: 64,
  topBarHeight: 56,
  navBarHeight: 80,
  bottomActionInset: 16,
} as const;

export const radii = {
  none: 0,
  /** Photos, thumbnails, plate frame (3), overlay tags. */
  photo: 2,
  plate: 3,
  /** Chips, text fields' inner elements. */
  sm: 4,
  /** Buttons, fields, segmented controls, list bands. */
  md: 6,
  /** Nav indicator. */
  lg: 8,
  /** Extended FAB. */
  fab: 14,
  /** Bottom sheet top corners. */
  sheet: 14,
  round: 999,
} as const;

export const lines = {
  /** Row dividers. Use 1, not StyleSheet.hairlineWidth: hairlines vanish in sunlight. */
  divider: 1,
  /** Outlined buttons, chips, segmented control, plate frame. */
  control: 1.5,
  /** Section rule on document-like screens (customer review, contract). */
  sectionRule: 1.5,
  /** Evidence header rule. */
  heavy: 2,
} as const;

export const touch = {
  /** Every tappable element. */
  min: 48,
  /** Minimum gap between adjacent targets. */
  gap: 8,
  buttonHeight: 52,
  buttonHeightSmall: 40,
  buttonHeightCustomer: 56,
  fabHeight: 56,
  chipHeight: 48,
  segmentedHeight: 44,
  shutter: 80,
  sliderHandle: 48,
  iconButton: 48,
} as const;

export const icon = {
  /** lucide-react-native: pass strokeWidth={icon.stroke} absoluteStrokeWidth. */
  stroke: 2,
  size: 24,
  sizeSmall: 20,
  sizeInline: 16,
  sizeLarge: 28,
} as const;

/* ------------------------------------------------------------------ */
/* Elevation. Flat by default; shadows only on things that float.      */
/* ------------------------------------------------------------------ */

export const elevation = {
  none: {},
  fab: {
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  sheet: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 12,
  },
  handle: {
    shadowColor: palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
} as const;

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/** Cubic-bezier control points; use with Easing.bezier(...motion.easing.standard). */
export const motion = {
  duration: {
    instant: 0,
    /** Press feedback, toggles, chip selection. */
    fast: 120,
    /** Most state changes: segment fill, row insert, snackbar. */
    base: 200,
    /** Sheets, screen push, mode switch cross-fade. */
    slow: 280,
    /** Post-shutter freeze frame before auto-advance. */
    freezeFrame: 400,
  },
  easing: {
    standard: [0.2, 0, 0, 1] as const,
    decelerate: [0, 0, 0, 1] as const,
    accelerate: [0.3, 0, 1, 1] as const,
  },
  /** Reanimated withSpring config for sheets and the slider handle release. No overshoot. */
  spring: { damping: 28, stiffness: 320, mass: 1, overshootClamping: true },
} as const;

/* ------------------------------------------------------------------ */
/* Evidence image and PDF (print identity)                             */
/* ------------------------------------------------------------------ */

export const evidence = {
  /** Export canvas, 3:2 landscape. */
  width: 3000,
  height: 2000,
  jpegQuality: 0.85,
  margin: 80,
  gutter: 60,
  /** Film-rebate frame around each photo, with edge code in the bottom band. */
  rebateFrame: 15,
  rebateCodeBand: 60,
  /** Sizes in px at export scale (2.5x the 1200 px mockup). */
  titleSize: 100,
  metaSize: 42,
  labelSize: 50,
  captionSize: 48,
  captionLineHeight: 68,
  legendSize: 40,
  codeSize: 30,
  markerBadge: 64,
  markerRingCore: 8,
  markerRingHalo: 16,
} as const;

export const print = {
  page: 'A4',
  marginMm: 16,
  bodyPt: 10.5,
  bodyLeadingPt: 15,
  h1Pt: 20,
  h2Pt: 13,
  smallPt: 8.5,
  rulePt: 0.5,
  ruleColor: palette.outline,
} as const;

/* ------------------------------------------------------------------ */

export const theme = {
  palette,
  light,
  rebate,
  overlay,
  marker,
  markerGeometry,
  fontFamily,
  type,
  customerType,
  fontScaleCap,
  space,
  layout,
  radii,
  lines,
  touch,
  icon,
  elevation,
  motion,
  evidence,
  print,
} as const;

export type Theme = typeof theme;
export default theme;
