import type { BlurEffect, Effect, ShadowEffect } from '@fit-to-figma/tree';
import { parseFunction, round, splitSpaces, splitTop } from './css.js';
import { BLACK, parseColor, type ColorContext, type ColorValue } from './color.js';
import { toPx, type LengthContext } from './length.js';

export interface ShadowContext extends LengthContext, ColorContext {}

/**
 * `box-shadow` to the tree's effects, in the order the page listed them.
 * A shadow marked `inset` becomes an inner shadow, which is what Figma calls
 * the same thing. 'none' and an unreadable string both give nothing.
 */
export function mapBoxShadow(css: string, ctx: ShadowContext = {}): ShadowEffect[] {
  return shadowList(css, ctx, true);
}

/**
 * `text-shadow` to the tree's effects. There is no spread and no inset in
 * text-shadow, so every one of these is a drop shadow with a spread of zero.
 */
export function mapTextShadow(css: string, ctx: ShadowContext = {}): ShadowEffect[] {
  return shadowList(css, ctx, false);
}

/**
 * `filter` to the tree's blur. Only `blur()` survives: Figma has no brightness
 * or saturate on a layer. The radius carries across one to one.
 */
export function mapFilter(css: string): BlurEffect[] {
  return blurList(css, 'blur');
}

/** `backdrop-filter` to the tree's backdrop blur, on the same terms. */
export function mapBackdropFilter(css: string): BlurEffect[] {
  return blurList(css, 'backdrop-blur');
}

/** Everything that makes an effect on one element, in paint order. */
export function mapEffects(
  style: {
    boxShadow?: string;
    textShadow?: string;
    filter?: string;
    backdropFilter?: string;
  },
  ctx: ShadowContext = {},
): Effect[] {
  return [
    ...mapBoxShadow(style.boxShadow ?? '', ctx),
    ...mapTextShadow(style.textShadow ?? '', ctx),
    ...mapFilter(style.filter ?? ''),
    ...mapBackdropFilter(style.backdropFilter ?? ''),
  ];
}

// ---------------------------------------------------------------- inside

function shadowList(css: string, ctx: ShadowContext, allowInset: boolean): ShadowEffect[] {
  const text = css.trim();
  if (text === '' || text.toLowerCase() === 'none') return [];

  const out: ShadowEffect[] = [];
  for (const item of splitTop(text, ',')) {
    const shadow = oneShadow(item, ctx, allowInset);
    if (shadow) out.push(shadow);
  }
  return out;
}

function oneShadow(
  item: string,
  ctx: ShadowContext,
  allowInset: boolean,
): ShadowEffect | null {
  const tokens = splitSpaces(item);
  if (tokens.length === 0) return null;

  let inset = false;
  let color: ColorValue | null = null;
  const lengths: number[] = [];

  for (const token of tokens) {
    const word = token.toLowerCase();
    if (word === 'inset') {
      inset = true;
      continue;
    }
    const px = toPx(token, ctx);
    if (px !== null) {
      lengths.push(px);
      continue;
    }
    const parsed = parseColor(token, ctx);
    if (parsed !== null && color === null) color = parsed;
  }

  // Two lengths is the smallest legal shadow: an x and a y.
  if (lengths.length < 2) return null;

  const fallback = ctx.currentColor ? (parseColor(ctx.currentColor) ?? BLACK) : BLACK;
  const paint = color ?? fallback;

  return {
    type: inset && allowInset ? 'inner-shadow' : 'shadow',
    x: round(lengths[0] as number),
    y: round(lengths[1] as number),
    blur: Math.max(0, round(lengths[2] ?? 0)),
    spread: allowInset ? round(lengths[3] ?? 0) : 0,
    color: paint.color,
    opacity: paint.opacity,
  };
}

function blurList(css: string, type: BlurEffect['type']): BlurEffect[] {
  const text = css.trim();
  if (text === '' || text.toLowerCase() === 'none') return [];

  const out: BlurEffect[] = [];
  for (const token of splitSpaces(text)) {
    const fn = parseFunction(token);
    if (!fn || fn.name !== 'blur') continue;
    const radius = toPx(fn.args.trim());
    if (radius === null || radius <= 0) continue;
    out.push({ type, radius: round(radius) });
  }
  return out;
}
