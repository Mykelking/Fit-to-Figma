import type { Corners } from '@fit-to-figma/tree';
import { clamp, round, splitSpaces, splitTop } from './css.js';
import { toPx, type LengthContext } from './length.js';

export interface Box {
  w: number;
  h: number;
}

export const NO_RADIUS: Corners = [0, 0, 0, 0];

/**
 * `border-radius` to the tree's four corners, tl tr br bl.
 *
 * The shorthand's one to four values expand the CSS way. The `/` form gives a
 * horizontal radius and a vertical one; Figma has a single radius per corner,
 * so the horizontal one is taken. A percentage is a percentage of the box's
 * width. Every corner is clamped to half the shorter side, which is where a
 * browser lands too once its own scaling has run.
 */
export function mapRadius(css: string, box: Box, ctx: LengthContext = {}): Corners {
  const text = css.trim();
  if (text === '' || text.toLowerCase() === 'none') return [...NO_RADIUS] as Corners;

  const sides = splitTop(text, '/');
  const horizontal = sides[0] ?? text;

  const values = splitSpaces(horizontal)
    .map((token) => corner(token, box, ctx))
    .filter((value): value is number => value !== null);

  if (values.length === 0) return [...NO_RADIUS] as Corners;

  const [a, b, c, d] = expand(values);
  const cap = Math.max(0, Math.min(box.w, box.h) / 2);
  const fit = (value: number): number => round(clamp(value, 0, cap));

  return [fit(a), fit(b), fit(c), fit(d)];
}

/** True when nothing is rounded, so the field can be left off the node. */
export function isSquare(corners: Corners): boolean {
  return corners.every((value) => value === 0);
}

// ---------------------------------------------------------------- inside

function corner(token: string, box: Box, ctx: LengthContext): number | null {
  const text = token.trim();
  if (text.endsWith('%')) {
    const pct = Number(text.slice(0, -1));
    return Number.isFinite(pct) ? (pct / 100) * box.w : null;
  }
  return toPx(text, ctx);
}

/** The CSS one-to-four shorthand: 1 all, 2 tl/br and tr/bl, 3 and 4 in order. */
function expand(values: number[]): [number, number, number, number] {
  const tl = values[0] as number;
  const tr = values[1] ?? tl;
  const br = values[2] ?? tl;
  const bl = values[3] ?? tr;
  return [tl, tr, br, bl];
}
