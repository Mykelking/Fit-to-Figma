import type { Layout, LayoutAlign, LayoutJustify, LayoutMode, Padding, Sizing } from '@fit-to-figma/tree';
import { read, round, splitSpaces, toNumber, type Computed } from './css.js';
import { toPx, toPxOr, type LengthContext } from './length.js';

export interface LayoutResult {
  /** null means the children are placed absolutely. */
  layout: Layout | null;
  notes: string[];
  /**
   * A grid's track width. When a grid became a wrapping row, every child is
   * given this as a fixed width, which is what kept the columns lined up.
   */
  track?: number;
}

const ALIGN: Readonly<Record<string, LayoutAlign>> = {
  'flex-start': 'start',
  start: 'start',
  'self-start': 'start',
  'self-end': 'end',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  stretch: 'stretch',
  normal: 'stretch',
};

const JUSTIFY: Readonly<Record<string, LayoutJustify>> = {
  'flex-start': 'start',
  start: 'start',
  normal: 'start',
  left: 'start',
  center: 'center',
  'flex-end': 'end',
  end: 'end',
  right: 'end',
  'space-between': 'space-between',
};

/**
 * A container's computed style to the tree's `layout`.
 *
 * A flex container comes through whole. A grid whose tracks are all the same
 * width becomes a wrapping row, with the track width to give the children.
 * Anything else returns null: the extractor places those children absolutely,
 * which is what the doc asks for.
 */
export function mapLayout(style: Computed, ctx: LengthContext = {}): LayoutResult {
  const notes: string[] = [];
  const display = read(style, 'display').toLowerCase();

  if (display === 'flex' || display === 'inline-flex') {
    return { layout: flexLayout(style, ctx, notes), notes };
  }

  if (display === 'grid' || display === 'inline-grid') {
    return gridLayout(style, ctx, notes);
  }

  return { layout: null, notes };
}

/**
 * A child's computed style to the tree's `sizing`.
 * `parentMode` says which axis is the main one; without it a row is assumed.
 */
export interface SizingContext extends LengthContext {
  parentMode?: LayoutMode;
  /** The parent's cross-axis alignment, for `align-self: auto`. */
  parentAlign?: LayoutAlign;
}

export function mapSizing(style: Computed, ctx: SizingContext = {}): Sizing {
  const mode = ctx.parentMode ?? 'row';
  const sizing: Sizing = {
    w: axisSizing(read(style, 'width')),
    h: axisSizing(read(style, 'height')),
  };

  // flex-grow wins on the main axis, even over an explicit width.
  if (growOf(style) > 0) {
    if (mode === 'row') sizing.w = 'fill';
    else sizing.h = 'fill';
  }

  // Stretch only reaches an axis the page left to itself.
  const self = read(style, 'align-self').toLowerCase();
  const align = self === '' || self === 'auto' || self === 'normal'
    ? (ctx.parentAlign ?? 'stretch')
    : (ALIGN[self] ?? 'stretch');

  if (align === 'stretch') {
    if (mode === 'row' && sizing.h === 'hug') sizing.h = 'fill';
    if (mode === 'column' && sizing.w === 'hug') sizing.w = 'fill';
  }

  return sizing;
}

/** `padding` and its longhands to top, right, bottom, left. */
export function mapPadding(style: Computed, ctx: LengthContext = {}): Padding {
  const longhand: Padding = [
    toPx(read(style, 'padding-top'), ctx) ?? Number.NaN,
    toPx(read(style, 'padding-right'), ctx) ?? Number.NaN,
    toPx(read(style, 'padding-bottom'), ctx) ?? Number.NaN,
    toPx(read(style, 'padding-left'), ctx) ?? Number.NaN,
  ];
  if (longhand.every((value) => Number.isFinite(value))) return longhand;

  const shorthand = read(style, 'padding');
  if (shorthand === '') return [0, 0, 0, 0];

  const values = splitSpaces(shorthand)
    .map((token) => toPx(token, ctx))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return [0, 0, 0, 0];

  const top = values[0] as number;
  const right = values[1] ?? top;
  const bottom = values[2] ?? top;
  const left = values[3] ?? right;
  return [round(top), round(right), round(bottom), round(left)];
}

/** The gap that matters on this axis. */
export function mapGap(style: Computed, mode: LayoutMode, ctx: LengthContext = {}): number {
  const [rowGap, columnGap] = gaps(style, ctx);
  return mode === 'row' ? columnGap : rowGap;
}

// ---------------------------------------------------------------- inside

function flexLayout(style: Computed, ctx: LengthContext, notes: string[]): Layout {
  const direction = read(style, 'flex-direction').toLowerCase() || 'row';
  const mode: LayoutMode = direction.startsWith('column') ? 'column' : 'row';
  if (direction.endsWith('-reverse')) {
    notes.push(`${direction} was laid out forwards: the children are already in paint order`);
  }

  const wrapValue = read(style, 'flex-wrap').toLowerCase();
  const wrap = wrapValue.startsWith('wrap');

  const [rowGap, columnGap] = gaps(style, ctx);
  const gap = mode === 'row' ? columnGap : rowGap;
  if (wrap && rowGap !== columnGap) {
    notes.push(
      `row-gap ${rowGap} and column-gap ${columnGap} differ: the tree keeps one gap, ${gap}`,
    );
  }

  const alignValue = read(style, 'align-items').toLowerCase();
  const align = ALIGN[alignValue] ?? 'stretch';
  if (alignValue === 'baseline' || alignValue === 'last baseline') {
    notes.push('align-items: baseline became start: Figma has no baseline alignment');
  }

  const justifyValue = read(style, 'justify-content').toLowerCase();
  const justify = JUSTIFY[justifyValue] ?? 'start';
  if (justifyValue === 'space-around' || justifyValue === 'space-evenly') {
    notes.push(`justify-content: ${justifyValue} became space-between`);
  }

  return {
    mode,
    gap: round(gap),
    padding: mapPadding(style, ctx),
    align: alignValue === 'baseline' || alignValue === 'last baseline' ? 'start' : align,
    justify:
      justifyValue === 'space-around' || justifyValue === 'space-evenly'
        ? 'space-between'
        : justify,
    wrap,
  };
}

function gridLayout(style: Computed, ctx: LengthContext, notes: string[]): LayoutResult {
  const tracks = splitSpaces(read(style, 'grid-template-columns'))
    .map((token) => toPx(token, ctx))
    .filter((value): value is number => value !== null);

  const even = tracks.length > 0 && tracks.every((value) => Math.abs(value - (tracks[0] as number)) < 0.5);
  if (!even) {
    notes.push('a grid whose tracks are not all the same width stayed absolute');
    return { layout: null, notes };
  }

  const track = round(tracks[0] as number);
  const [rowGap, columnGap] = gaps(style, ctx);
  notes.push(
    `a grid of ${tracks.length} equal tracks became a wrapping row; each child is ${track}px wide`,
  );

  const alignValue = read(style, 'align-items').toLowerCase();

  const layout: Layout = {
    mode: 'row',
    gap: round(columnGap),
    padding: mapPadding(style, ctx),
    align: ALIGN[alignValue] ?? 'stretch',
    justify: JUSTIFY[read(style, 'justify-content').toLowerCase()] ?? 'start',
    wrap: true,
  };

  if (rowGap !== columnGap) {
    notes.push(
      `row-gap ${rowGap} and column-gap ${columnGap} differ: the tree keeps one gap, ${layout.gap}`,
    );
  }

  return { layout, notes, track };
}

/** [row-gap, column-gap], from the longhands or the `gap` shorthand. */
function gaps(style: Computed, ctx: LengthContext): [number, number] {
  const shorthand = splitSpaces(read(style, 'gap'))
    .map((token) => toPx(token, ctx))
    .filter((value): value is number => value !== null);
  const fallbackRow = shorthand[0] ?? 0;
  const fallbackColumn = shorthand[1] ?? fallbackRow;

  const row = toPxOr(read(style, 'row-gap'), fallbackRow, ctx);
  const column = toPxOr(read(style, 'column-gap'), fallbackColumn, ctx);
  return [round(row), round(column)];
}

function axisSizing(value: string): Sizing['w'] {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'auto' || text === 'max-content' || text === 'min-content') {
    return 'hug';
  }
  if (text === '100%' || text === 'fit-content' || text === '-webkit-fill-available') {
    return 'fill';
  }
  return toPx(text) === null ? 'hug' : 'fixed';
}

function growOf(style: Computed): number {
  const direct = toNumber(read(style, 'flex-grow'));
  if (direct !== null) return direct;
  const shorthand = splitSpaces(read(style, 'flex'));
  const first = toNumber(shorthand[0] ?? '');
  return first ?? 0;
}
