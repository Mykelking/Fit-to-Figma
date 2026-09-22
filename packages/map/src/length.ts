import { round } from './css.js';

/**
 * What a relative length needs to become an absolute one.
 * Anything missing takes its usual default: 16px for a root font size, and
 * the font size falls back to the root size.
 */
export interface LengthContext {
  /** The root element's font size. Default 16. */
  root?: number;
  /** This element's font size, for `em`. Defaults to the root size. */
  font?: number;
  /** The length a percentage is a percentage of. */
  parent?: number;
  viewport?: { w: number; h: number };
}

const ABSOLUTE: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

const NUMBER = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;

/**
 * A CSS length to pixels, or null when there is nothing to work out:
 * 'auto', 'normal', an empty string, a unit we do not know, or a percentage
 * with no parent to take a percentage of.
 */
export function toPx(value: string, ctx: LengthContext = {}): number | null {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'auto' || text === 'normal' || text === 'none') return null;

  const match = NUMBER.exec(text);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  if (!Number.isFinite(amount)) return null;

  const root = ctx.root ?? 16;
  const font = ctx.font ?? root;

  if (unit === '') return amount === 0 ? 0 : amount;

  const absolute = ABSOLUTE[unit];
  if (absolute !== undefined) return round(amount * absolute);

  switch (unit) {
    case 'em':
      return round(amount * font);
    case 'rem':
      return round(amount * root);
    case 'ch':
      // No font metrics here: the usual stand-in is half an em.
      return round(amount * font * 0.5);
    case 'ex':
      return round(amount * font * 0.5);
    case '%': {
      if (ctx.parent === undefined) return null;
      return round((amount / 100) * ctx.parent);
    }
    case 'vw':
      return ctx.viewport ? round((amount / 100) * ctx.viewport.w) : null;
    case 'vh':
      return ctx.viewport ? round((amount / 100) * ctx.viewport.h) : null;
    case 'vmin':
      return ctx.viewport
        ? round((amount / 100) * Math.min(ctx.viewport.w, ctx.viewport.h))
        : null;
    case 'vmax':
      return ctx.viewport
        ? round((amount / 100) * Math.max(ctx.viewport.w, ctx.viewport.h))
        : null;
    default:
      return null;
  }
}

/** The same, with something to fall back on. */
export function toPxOr(value: string, fallback: number, ctx: LengthContext = {}): number {
  const px = toPx(value, ctx);
  return px === null ? fallback : px;
}

/** An angle in any CSS unit to degrees. */
export function toDegrees(value: string): number | null {
  const text = value.trim().toLowerCase();
  const match = NUMBER.exec(text);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  switch ((match[2] ?? '').toLowerCase()) {
    case '':
    case 'deg':
      return round(amount);
    case 'grad':
      return round(amount * 0.9);
    case 'rad':
      return round((amount * 180) / Math.PI);
    case 'turn':
      return round(amount * 360);
    default:
      return null;
  }
}

/** Into [0, 360). */
export function normalizeAngle(degrees: number): number {
  return round(((degrees % 360) + 360) % 360);
}
