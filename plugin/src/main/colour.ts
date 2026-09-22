export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3,8})$/i;

/**
 * '#rgb', '#rrggbb' and '#rrggbbaa' all read. Anything else is black, and the
 * caller decides whether that is worth a warning.
 */
export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m || m[1] === undefined) return { r: 0, g: 0, b: 0 };
  let s = m[1];
  if (s.length === 3 || s.length === 4) {
    s = s
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** The alpha carried inside an 8 digit hex, or 1 when there is none. */
export function hexAlpha(hex: string): number {
  const m = HEX.exec(hex.trim());
  if (!m || m[1] === undefined) return 1;
  const s = m[1];
  if (s.length === 8) return parseInt(s.slice(6, 8), 16) / 255;
  if (s.length === 4) {
    const c = s.slice(3, 4);
    return parseInt(c + c, 16) / 255;
  }
  return 1;
}

/** '#rrggbb', lower case, for comparing a node's colour with a token's. */
export function normaliseHex(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const two = (n: number): string => Math.round(n * 255).toString(16).padStart(2, '0');
  return '#' + two(r) + two(g) + two(b);
}

export function looksLikeColour(value: string): boolean {
  return HEX.test(value.trim());
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
