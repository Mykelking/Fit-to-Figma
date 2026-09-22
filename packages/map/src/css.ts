/**
 * The small amount of CSS text handling every other module needs.
 * No DOM, no regular expression that cannot cope with nesting.
 */

/** Split on a separator that sits outside brackets and quotes. */
export function splitTop(input: string, separator = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;
    if (quote) {
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === separator && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(input.slice(start).trim());
  return out.filter((part) => part.length > 0);
}

/** Split on runs of whitespace that sit outside brackets and quotes. */
export function splitSpaces(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i] as string;
    if (quote) {
      current += ch;
      if (ch === quote && input[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && /\s/.test(ch)) {
      if (current.length > 0) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length > 0) out.push(current);
  return out;
}

export interface CssFunction {
  name: string;
  args: string;
}

/** 'linear-gradient(a, b)' becomes { name: 'linear-gradient', args: 'a, b' }. */
export function parseFunction(input: string): CssFunction | null {
  const text = input.trim();
  const open = text.indexOf('(');
  if (open <= 0 || !text.endsWith(')')) return null;
  const name = text.slice(0, open).trim().toLowerCase();
  if (!/^[a-z-]+$/.test(name)) return null;
  return { name, args: text.slice(open + 1, -1) };
}

/** A bare number, or null. '12' yes, '12px' no. */
export function toNumber(input: string): number | null {
  const text = input.trim();
  if (text.length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Keep the arithmetic honest without carrying float dust into the tree. */
export function round(value: number, places = 3): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** A computed style bag: whatever getComputedStyle handed over, or a fixture. */
export type Computed = Record<string, string | undefined>;

/** Read a property by its CSS name, falling back to the camelCase spelling. */
export function read(style: Computed, property: string): string {
  const direct = style[property];
  if (direct !== undefined && direct !== '') return direct.trim();
  const camel = property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const alt = style[camel];
  if (alt !== undefined && alt !== '') return alt.trim();
  return '';
}
