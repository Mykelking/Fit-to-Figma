/**
 * @fit-to-figma/map
 *
 * The pure half of the extractor: CSS computed values in, design tree values
 * out. No DOM, no Figma, no state. Every function here can be called from a
 * test, from the page, or from the plugin.
 */

export type { Computed, CssFunction } from './css.js';
export { clamp, parseFunction, read, round, splitSpaces, splitTop, toNumber } from './css.js';

export type { LengthContext } from './length.js';
export { normalizeAngle, toDegrees, toPx, toPxOr } from './length.js';

export type { ColorContext, ColorValue } from './color.js';
export { BLACK, TRANSPARENT, isColor, parseColor, parseColorOr, toHex } from './color.js';
export { NAMED_COLORS } from './named-colors.js';

export type { GradientContext, PaintResult } from './gradient.js';
export { gradientFallback, mapGradient } from './gradient.js';

export type { ShadowContext } from './shadow.js';
export {
  mapBackdropFilter,
  mapBoxShadow,
  mapEffects,
  mapFilter,
  mapTextShadow,
} from './shadow.js';

export type { Box } from './radius.js';
export { isSquare, mapRadius, NO_RADIUS } from './radius.js';

export type { LayoutResult, SizingContext } from './layout.js';
export { mapGap, mapLayout, mapPadding, mapSizing } from './layout.js';

export type { FamilyStack, TextContext } from './text.js';
export {
  mapFont,
  mapFontFamily,
  mapFontStyle,
  mapFontWeight,
  mapLetterSpacing,
  mapLineHeight,
  mapTextAlign,
  mapTextDecoration,
  mapTextStyle,
  mapTextTransform,
} from './text.js';
