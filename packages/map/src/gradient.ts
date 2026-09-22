import type { GradientStop, LinearPaint, Paint, SolidPaint } from '@fit-to-figma/tree';
import { clamp, parseFunction, round, splitSpaces, splitTop } from './css.js';
import { parseColor, type ColorContext, type ColorValue } from './color.js';
import { normalizeAngle, toDegrees, toPx, type LengthContext } from './length.js';

export interface GradientContext extends LengthContext, ColorContext {
  /**
   * How long the gradient line is, in pixels. Only needed when the page gave a
   * stop in a length rather than a percentage; without it such a stop is
   * spaced evenly instead and a note says so.
   */
  lineLength?: number;
}

export interface PaintResult {
  paint: Paint;
  /** What we could not keep exactly. The CLI prints these in the run report. */
  notes: string[];
}

/**
 * Degrees clockwise from "to top", the same reading CSS uses.
 * A corner in CSS depends on the box's shape; the tree takes the 45 degree
 * diagonal and the caller gets a note.
 */
const SIDES: Readonly<Record<string, number>> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  'top right': 45,
  'right top': 45,
  'bottom right': 135,
  'right bottom': 135,
  'bottom left': 225,
  'left bottom': 225,
  'top left': 315,
  'left top': 315,
};

const CORNERS = new Set(['45', '135', '225', '315']);

/**
 * A CSS gradient to the tree's paint.
 *
 * `linear-gradient` comes through whole. `radial-gradient` becomes the nearest
 * linear one and says so. Anything else that is still a gradient becomes a
 * solid of its first stop. A string that is not a gradient returns null.
 */
export function mapGradient(css: string, ctx: GradientContext = {}): PaintResult | null {
  const fn = parseFunction(css);
  if (!fn || !fn.name.endsWith('gradient')) return null;

  const notes: string[] = [];
  if (fn.name.startsWith('repeating-')) {
    notes.push('a repeating gradient was drawn once: Figma does not repeat a gradient');
  }

  const parts = splitTop(fn.args, ',');
  if (parts.length === 0) return null;

  const kind = fn.name.replace('repeating-', '');
  let angle = 180;
  let rest = parts;

  if (kind === 'linear-gradient') {
    const direction = readDirection(parts[0] ?? '', notes);
    if (direction !== null) {
      angle = direction;
      rest = parts.slice(1);
    }
  } else if (kind === 'radial-gradient') {
    if (isRadialShape(parts[0] ?? '')) rest = parts.slice(1);
    notes.push('a radial gradient was flattened to the nearest linear one');
  }

  const stops = readStops(rest, ctx, notes);
  if (stops.length === 0) return null;

  const first = stops[0] as GradientStop;

  if (kind !== 'linear-gradient' && kind !== 'radial-gradient') {
    notes.push(`${kind} is not a gradient Figma draws: it became a solid of its first stop`);
    return { paint: solid(first), notes };
  }

  if (stops.length === 1) {
    notes.push('a gradient with one stop became a solid');
    return { paint: solid(first), notes };
  }

  const paint: LinearPaint = { type: 'linear', angle: normalizeAngle(angle), stops };
  return { paint, notes };
}

/** The first stop on its own, for callers that want a fallback colour. */
export function gradientFallback(css: string, ctx: GradientContext = {}): SolidPaint | null {
  const result = mapGradient(css, ctx);
  if (!result) return null;
  if (result.paint.type === 'solid') return result.paint;
  if (result.paint.type === 'linear') {
    const first = result.paint.stops[0];
    return first ? solid(first) : null;
  }
  return null;
}

// ---------------------------------------------------------------- inside

function solid(stop: GradientStop): SolidPaint {
  return { type: 'solid', color: stop.color, opacity: stop.opacity };
}

/** An angle, a side keyword, or null when this part is already a colour stop. */
function readDirection(part: string, notes: string[]): number | null {
  const text = part.trim().toLowerCase();
  if (text === '') return null;

  if (text.startsWith('to ')) {
    const sides = text
      .slice(3)
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .join(' ');
    const angle = SIDES[sides];
    if (angle === undefined) return null;
    if (CORNERS.has(String(angle))) {
      notes.push(`'to ${sides}' became ${angle} degrees: a corner in CSS follows the box shape`);
    }
    return angle;
  }

  // An angle only counts as a direction when it is not also a colour.
  if (parseColor(text) !== null) return null;
  return toDegrees(text);
}

function isRadialShape(part: string): boolean {
  const text = part.trim().toLowerCase();
  if (parseColor(splitSpaces(text)[0] ?? '') !== null) return false;
  return /\b(circle|ellipse|at|closest-side|closest-corner|farthest-side|farthest-corner)\b/.test(
    text,
  );
}

interface LooseStop {
  color: ColorValue;
  at: number | undefined;
}

function readStops(parts: string[], ctx: GradientContext, notes: string[]): GradientStop[] {
  const loose: LooseStop[] = [];

  for (const part of parts) {
    const tokens = splitSpaces(part);
    const head = tokens[0] ?? '';
    const color = parseColor(head, ctx);

    if (color === null) {
      if (tokens.length === 1 && position(head, ctx, notes) !== null) {
        notes.push('a gradient colour hint was dropped: Figma has no midpoint stop');
        continue;
      }
      notes.push(`a gradient stop was unreadable and dropped: '${part}'`);
      continue;
    }

    const positions = tokens
      .slice(1)
      .map((token) => position(token, ctx, notes))
      .filter((value): value is number => value !== null);

    if (positions.length === 0) {
      loose.push({ color, at: undefined });
    } else {
      for (const at of positions) loose.push({ color, at });
    }
  }

  return spread(loose);
}

/** A stop position to 0..1, or null when it is not a position at all. */
function position(token: string, ctx: GradientContext, notes: string[]): number | null {
  const text = token.trim();
  if (text.endsWith('%')) {
    const pct = Number(text.slice(0, -1));
    return Number.isFinite(pct) ? pct / 100 : null;
  }
  const px = toPx(text, ctx);
  if (px === null) return null;
  if (ctx.lineLength === undefined || ctx.lineLength === 0) {
    notes.push(`a stop at '${text}' was spaced evenly: the gradient line length is unknown`);
    return null;
  }
  return px / ctx.lineLength;
}

/** The CSS rule: ends default to 0 and 1, gaps space evenly, and never go back. */
function spread(loose: LooseStop[]): GradientStop[] {
  if (loose.length === 0) return [];

  const at: Array<number | undefined> = loose.map((stop) => stop.at);
  if (at[0] === undefined) at[0] = 0;
  if (at[at.length - 1] === undefined) at[at.length - 1] = 1;

  let i = 0;
  while (i < at.length) {
    if (at[i] !== undefined) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < at.length && at[j] === undefined) j += 1;
    const before = at[i - 1] as number;
    const after = at[j] as number;
    const steps = j - i + 1;
    for (let k = i; k < j; k += 1) {
      at[k] = before + ((after - before) * (k - i + 1)) / steps;
    }
    i = j;
  }

  let highest = 0;
  return loose.map((stop, index) => {
    const value = clamp(at[index] as number, 0, 1);
    highest = Math.max(highest, value);
    return {
      at: round(highest, 4),
      color: stop.color.color,
      opacity: stop.color.opacity,
    };
  });
}
