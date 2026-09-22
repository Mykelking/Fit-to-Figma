import type { FontStyle, TextAlign, TextDecoration, TextStyle, TextTransform } from '@fit-to-figma/tree';
import { read, round, splitTop, toNumber, type Computed } from './css.js';
import { BLACK, parseColor, type ColorContext } from './color.js';
import { toPx, type LengthContext } from './length.js';

export interface TextContext extends LengthContext, ColorContext {
  /** For `text-align: start` and `end`. Default 'ltr'. */
  direction?: 'ltr' | 'rtl';
}

export interface FamilyStack {
  /** The first family named: the one Figma is asked for. */
  family: string;
  /** The rest, in order, for the run's report when the first is missing. */
  fallbacks: string[];
}

const WEIGHTS: Readonly<Record<string, number>> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  lighter: 300,
  normal: 400,
  regular: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  bolder: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

/** 'Plus Jakarta Sans', system-ui, sans-serif → the first one and the rest. */
export function mapFontFamily(stack: string): FamilyStack {
  const names = splitTop(stack, ',')
    .map((name) => name.trim().replace(/^["']|["']$/g, '').trim())
    .filter((name) => name.length > 0);

  const family = names[0] ?? 'Inter';
  return { family, fallbacks: names.slice(1) };
}

/** A weight name or number to the number Figma wants. */
export function mapFontWeight(value: string): number {
  const text = value.trim().toLowerCase();
  if (text === '') return 400;

  const number = toNumber(text);
  if (number !== null) return Math.round(Math.min(1000, Math.max(1, number)));

  return WEIGHTS[text.replace(/[\s-]/g, '')] ?? 400;
}

export function mapFontStyle(value: string): FontStyle['style'] {
  const text = value.trim().toLowerCase();
  return text.startsWith('italic') || text.startsWith('oblique') ? 'italic' : 'normal';
}

/**
 * `line-height` to pixels. 'normal' is the browser's usual 1.2 of the font
 * size; a bare number is a multiple of it; a length is itself.
 */
export function mapLineHeight(
  value: string,
  fontSize: number,
  ctx: LengthContext = {},
): number {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'normal') return round(fontSize * 1.2);

  const multiple = toNumber(text);
  if (multiple !== null) return round(multiple * fontSize);

  const px = toPx(text, { ...ctx, font: fontSize, parent: fontSize });
  return px === null ? round(fontSize * 1.2) : round(px);
}

/** `letter-spacing` to pixels. 'normal' is nothing; `em` is of the font size. */
export function mapLetterSpacing(
  value: string,
  fontSize: number,
  ctx: LengthContext = {},
): number {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'normal') return 0;

  // A bare number is not a length here, so it is worth nothing.
  if (toNumber(text) !== null) return 0;

  const px = toPx(text, { ...ctx, font: fontSize, parent: fontSize });
  return px === null ? 0 : round(px);
}

/** `capitalize` has no counterpart in Figma, so it stays as the page drew it. */
export function mapTextTransform(value: string): TextTransform {
  const text = value.trim().toLowerCase();
  if (text === 'uppercase') return 'upper';
  if (text === 'lowercase') return 'lower';
  return 'none';
}

/** Reads the shorthand too: Chrome gives 'underline solid rgb(0, 0, 0)'. */
export function mapTextDecoration(value: string): TextDecoration {
  const text = value.trim().toLowerCase();
  if (text.includes('line-through')) return 'strike';
  if (text.includes('underline')) return 'underline';
  return 'none';
}

export function mapTextAlign(value: string, direction: 'ltr' | 'rtl' = 'ltr'): TextAlign {
  const text = value.trim().toLowerCase();
  switch (text) {
    case 'center':
      return 'center';
    case 'right':
      return 'right';
    case 'left':
      return 'left';
    case 'start':
      return direction === 'rtl' ? 'right' : 'left';
    case 'end':
      return direction === 'rtl' ? 'left' : 'right';
    case 'justify':
      // Figma has no justified text; the page's reading direction is kept.
      return direction === 'rtl' ? 'right' : 'left';
    default:
      return direction === 'rtl' ? 'right' : 'left';
  }
}

/** Everything about the font of one run. */
export function mapFont(style: Computed, ctx: TextContext = {}): FontStyle {
  const size = toPx(read(style, 'font-size'), ctx) ?? ctx.root ?? 16;
  const { family } = mapFontFamily(read(style, 'font-family'));

  return {
    family,
    weight: mapFontWeight(read(style, 'font-weight')),
    style: mapFontStyle(read(style, 'font-style')),
    size: round(size),
    lineHeight: mapLineHeight(read(style, 'line-height'), size, ctx),
    letterSpacing: mapLetterSpacing(read(style, 'letter-spacing'), size, ctx),
  };
}

/** A run of text and its computed style to the tree's `text`. */
export function mapTextStyle(
  content: string,
  style: Computed,
  ctx: TextContext = {},
): TextStyle {
  const paint = parseColor(read(style, 'color'), ctx) ?? BLACK;
  const decoration = read(style, 'text-decoration-line') || read(style, 'text-decoration');

  return {
    content,
    font: mapFont(style, ctx),
    color: paint.color,
    opacity: paint.opacity,
    align: mapTextAlign(read(style, 'text-align'), ctx.direction ?? 'ltr'),
    decoration: mapTextDecoration(decoration),
    transform: mapTextTransform(read(style, 'text-transform')),
  };
}
