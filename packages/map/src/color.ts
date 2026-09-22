import { clamp, parseFunction, round, splitTop, splitSpaces } from './css.js';
import { toDegrees } from './length.js';
import { NAMED_COLORS } from './named-colors.js';

/**
 * A colour the way the tree holds one: the hex on its own and the alpha beside
 * it, because Figma keeps them apart too.
 */
export interface ColorValue {
  /** '#rrggbb', always six digits, always lower case. */
  color: string;
  /** 0 to 1. */
  opacity: number;
}

export interface ColorContext {
  /**
   * What `currentcolor` means here: the element's computed `color`.
   * Defaults to black, which is what a page with nothing set would give.
   */
  currentColor?: string;
}

export const BLACK: ColorValue = { color: '#000000', opacity: 1 };

/** A fully transparent colour: Figma wants a hex even when nothing shows. */
export const TRANSPARENT: ColorValue = { color: '#000000', opacity: 0 };

/**
 * Any CSS colour to a hex and an alpha, or null when the string is not a
 * colour at all. Handles hex in three, four, six and eight digits, the legacy
 * and the modern forms of rgb() and hsl(), hwb(), color(srgb …), every named
 * colour, `transparent` and `currentcolor`.
 */
export function parseColor(input: string, ctx: ColorContext = {}): ColorValue | null {
  const text = input.trim().toLowerCase();
  if (text === '') return null;

  if (text === 'transparent') return { ...TRANSPARENT };
  if (text === 'currentcolor') {
    const source = ctx.currentColor;
    if (source === undefined) return { ...BLACK };
    // Guard against `color: currentcolor` pointing back at itself.
    return parseColor(source, {}) ?? { ...BLACK };
  }
  if (text === 'inherit' || text === 'initial' || text === 'unset' || text === 'revert') {
    return null;
  }

  if (text.startsWith('#')) return fromHex(text);

  const named = NAMED_COLORS[text];
  if (named !== undefined) return { color: `#${named}`, opacity: 1 };

  const fn = parseFunction(text);
  if (!fn) return null;

  const parts = splitArguments(fn.args);
  switch (fn.name) {
    case 'rgb':
    case 'rgba':
      return fromRgb(parts);
    case 'hsl':
    case 'hsla':
      return fromHsl(parts);
    case 'hwb':
      return fromHwb(parts);
    case 'color':
      return fromColorFunction(parts);
    default:
      return null;
  }
}

/** The same, with something to fall back on when the string is unreadable. */
export function parseColorOr(
  input: string,
  fallback: ColorValue,
  ctx: ColorContext = {},
): ColorValue {
  return parseColor(input, ctx) ?? { ...fallback };
}

/** True when the string reads as a colour. Used to tell colours from lengths. */
export function isColor(input: string, ctx: ColorContext = {}): boolean {
  return parseColor(input, ctx) !== null;
}

export function toHex(r: number, g: number, b: number): string {
  const digit = (value: number): string =>
    Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0');
  return `#${digit(r)}${digit(g)}${digit(b)}`;
}

// ---------------------------------------------------------------- inside

/**
 * Both call styles at once: 'r, g, b, a' and 'r g b / a'. The slash form is
 * cut first so a modern call comes back as four parts like the legacy one.
 */
function splitArguments(args: string): string[] {
  const slash = splitTop(args, '/');
  if (slash.length === 2) {
    const head = slash[0] ?? '';
    const alpha = slash[1] ?? '';
    return [...splitComponents(head), alpha];
  }
  return splitComponents(args);
}

function splitComponents(text: string): string[] {
  const commas = splitTop(text, ',');
  if (commas.length > 1) return commas;
  return splitSpaces(text);
}

function fromHex(text: string): ColorValue | null {
  const digits = text.slice(1);
  if (!/^[0-9a-f]+$/.test(digits)) return null;

  const expand = (short: string): string =>
    short
      .split('')
      .map((ch) => ch + ch)
      .join('');

  let rgb: string;
  let alpha = 1;

  if (digits.length === 3) {
    rgb = expand(digits);
  } else if (digits.length === 4) {
    rgb = expand(digits.slice(0, 3));
    alpha = parseInt(expand(digits.slice(3)), 16) / 255;
  } else if (digits.length === 6) {
    rgb = digits;
  } else if (digits.length === 8) {
    rgb = digits.slice(0, 6);
    alpha = parseInt(digits.slice(6), 16) / 255;
  } else {
    return null;
  }

  return { color: `#${rgb}`, opacity: round(alpha) };
}

/** A channel that may be a number 0-255 or a percentage. */
function channel(text: string | undefined): number | null {
  if (text === undefined) return null;
  const value = text.trim();
  if (value === 'none') return 0;
  if (value.endsWith('%')) {
    const pct = Number(value.slice(0, -1));
    return Number.isFinite(pct) ? (pct / 100) * 255 : null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Alpha may be a number 0-1 or a percentage. */
function alphaOf(text: string | undefined): number {
  if (text === undefined) return 1;
  const value = text.trim();
  if (value === 'none') return 0;
  if (value.endsWith('%')) {
    const pct = Number(value.slice(0, -1));
    return Number.isFinite(pct) ? clamp(pct / 100, 0, 1) : 1;
  }
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 1;
}

/** A percentage that must be one, as 0-1. */
function percent(text: string | undefined): number | null {
  if (text === undefined) return null;
  const value = text.trim();
  if (value === 'none') return 0;
  const raw = value.endsWith('%') ? value.slice(0, -1) : value;
  const number = Number(raw);
  return Number.isFinite(number) ? clamp(number / 100, 0, 1) : null;
}

function fromRgb(parts: string[]): ColorValue | null {
  const r = channel(parts[0]);
  const g = channel(parts[1]);
  const b = channel(parts[2]);
  if (r === null || g === null || b === null) return null;
  return { color: toHex(r, g, b), opacity: round(alphaOf(parts[3])) };
}

function fromHsl(parts: string[]): ColorValue | null {
  const hue = toDegrees(parts[0] ?? '');
  const s = percent(parts[1]);
  const l = percent(parts[2]);
  if (hue === null || s === null || l === null) return null;

  const [r, g, b] = hslToRgb(hue, s, l);
  return { color: toHex(r, g, b), opacity: round(alphaOf(parts[3])) };
}

function fromHwb(parts: string[]): ColorValue | null {
  const hue = toDegrees(parts[0] ?? '');
  const white = percent(parts[1]);
  const black = percent(parts[2]);
  if (hue === null || white === null || black === null) return null;

  let w = white;
  let b = black;
  if (w + b > 1) {
    const total = w + b;
    w /= total;
    b /= total;
  }
  const [pr, pg, pb] = hslToRgb(hue, 1, 0.5);
  const mix = (channelValue: number): number =>
    (channelValue / 255) * (1 - w - b) * 255 + w * 255;
  return { color: toHex(mix(pr), mix(pg), mix(pb)), opacity: round(alphaOf(parts[3])) };
}

/** Only sRGB: anything wider has to be squashed to sRGB anyway for Figma. */
function fromColorFunction(parts: string[]): ColorValue | null {
  const space = (parts[0] ?? '').trim();
  if (space !== 'srgb') return null;
  const read = (text: string | undefined): number | null => {
    if (text === undefined) return null;
    const value = text.trim();
    if (value === 'none') return 0;
    const raw = value.endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
    return Number.isFinite(raw) ? clamp(raw, 0, 1) * 255 : null;
  };
  const r = read(parts[1]);
  const g = read(parts[2]);
  const b = read(parts[3]);
  if (r === null || g === null || b === null) return null;
  return { color: toHex(r, g, b), opacity: round(alphaOf(parts[4])) };
}

function hslToRgb(hueDegrees: number, s: number, l: number): [number, number, number] {
  const h = (((hueDegrees % 360) + 360) % 360) / 360;
  if (s === 0) {
    const grey = l * 255;
    return [grey, grey, grey];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hueToChannel(p, q, h + 1 / 3), hueToChannel(p, q, h), hueToChannel(p, q, h - 1 / 3)];
}

function hueToChannel(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return (p + (q - p) * 6 * value) * 255;
  if (value < 1 / 2) return q * 255;
  if (value < 2 / 3) return (p + (q - p) * (2 / 3 - value) * 6) * 255;
  return p * 255;
}
