import {
  isColor,
  mapBackdropFilter,
  mapBoxShadow,
  mapFilter,
  mapGradient,
  mapLayout,
  mapPadding,
  mapRadius,
  mapSizing,
  mapTextShadow,
  mapTextStyle,
  parseColor,
  type Computed,
  type LengthContext,
  type TextContext,
} from '@fit-to-figma/map';
import type {
  Corners,
  Effect,
  Layout,
  LayoutJustify,
  Padding,
  Paint,
  Sizing,
  SolidPaint,
  Stroke,
  TextStyle,
} from '@fit-to-figma/tree';
import type { Box } from './geometry.js';
import type { Warnings } from './warnings.js';

/**
 * The one place the extractor talks to `@fit-to-figma/map`.
 *
 * The extractor's job is the DOM: boxes, what is on screen, what the browser
 * drew. Turning a computed CSS string into a tree value is the map package's
 * job and is tested there on real strings. Every call into it is here, so when
 * that package moves there is one file to follow it.
 *
 * The map package reads a plain bag of strings, not a live `CSSStyleDeclaration`,
 * so that its tests can hand it a fixture. `computedOf` is the adapter.
 *
 * Reading a computed property is the extractor's inner loop - a page of 1,500
 * elements asks for tens of thousands of them - so several functions here look
 * at a shorthand first and only spell out the longhands when the shorthand says
 * there is something to spell out.
 */

export interface Viewport {
  w: number;
  h: number;
}

/** A lazy view over a live `CSSStyleDeclaration`, in the shape map reads. */
export function computedOf(style: CSSStyleDeclaration): Computed {
  return new Proxy({} as Computed, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      return style.getPropertyValue(property);
    },
    has() {
      return true;
    },
  });
}

export function read(style: CSSStyleDeclaration, property: string): string {
  const value = style.getPropertyValue(property);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * What a relative length needs here.
 *
 * A real browser hands back absolute pixels for nearly everything, so this
 * mostly matters for a test DOM and for the few properties that stay relative,
 * like `letter-spacing: 0.02em`.
 */
export function lengthContextOf(style: CSSStyleDeclaration, viewport: Viewport): LengthContext {
  const font = Number.parseFloat(read(style, 'font-size'));
  return { font: Number.isFinite(font) ? font : 16, root: 16, viewport };
}

function textContextOf(style: CSSStyleDeclaration, viewport: Viewport): TextContext {
  const direction = read(style, 'direction') === 'rtl' ? 'rtl' : 'ltr';
  return { ...lengthContextOf(style, viewport), currentColor: read(style, 'color'), direction };
}

/** A value that says nothing: absent, or one of the CSS wide keywords. */
function isNothing(value: string): boolean {
  const text = value.trim().toLowerCase();
  return (
    text === '' ||
    text === 'none' ||
    text === 'initial' ||
    text === 'inherit' ||
    text === 'unset' ||
    text === 'revert' ||
    text === 'revert-layer'
  );
}

// ------------------------------------------------------------------ colour

/** Is this string a colour at all? Used to type a custom property. */
export function isColorValue(value: string): boolean {
  return isColor(value);
}

export function solidOf(value: string, currentColor?: string): SolidPaint | null {
  if (!value) return null;
  const parsed = parseColor(value, currentColor ? { currentColor } : {});
  if (!parsed || parsed.opacity <= 0) return null;
  return { type: 'solid', color: parsed.color, opacity: parsed.opacity };
}

// ------------------------------------------------------------------- fills

export interface FillsArgs {
  style: CSSStyleDeclaration;
  box: Box;
  viewport: Viewport;
  /** Resolves one `url(...)` layer to an asset id, or null when it cannot. */
  resolveImage: (url: string) => Promise<string | null>;
  warnings: Warnings;
  nodeId: string;
}

/**
 * `background-color` and every `background-image` layer, bottom first.
 *
 * CSS paints the first background layer on top; Figma paints `fills[0]` at the
 * bottom. The layers are reversed here so the two agree, with the background
 * colour under all of them.
 */
export async function fillsOf(args: FillsArgs): Promise<Paint[]> {
  const { style, box, viewport, warnings, nodeId } = args;
  const fills: Paint[] = [];

  const backgroundColor = read(style, 'background-color');
  const background = backgroundColor ? solidOf(backgroundColor, read(style, 'color')) : null;
  if (background) fills.push(background);

  const image = read(style, 'background-image');
  if (isNothing(image)) return fills;

  const currentColor = read(style, 'color');
  const ctx = { ...lengthContextOf(style, viewport), currentColor, lineLength: box.w };
  const sizes = splitLayers(read(style, 'background-size'));
  const layers = splitLayers(image);
  const painted: Paint[] = [];

  for (let i = 0; i < layers.length; i += 1) {
    const layer = layers[i];
    if (!layer || isNothing(layer)) continue;

    const url = urlIn(layer);
    if (url) {
      const asset = await args.resolveImage(url);
      if (asset) painted.push({ type: 'image', asset, scale: scaleOf(sizes[i] ?? sizes[0] ?? '') });
      continue;
    }

    const gradient = mapGradient(layer, ctx);
    if (gradient) {
      painted.push(gradient.paint);
      for (const note of gradient.notes) {
        warnings.add('gradient-approximated', note, { node: nodeId });
      }
      continue;
    }

    warnings.add(
      'gradient-unsupported',
      'a background layer is not a colour, a gradient or an image, and was dropped',
      { detail: layer.slice(0, 80), node: nodeId },
    );
  }

  // Reversed: CSS paints the first layer on top, Figma paints the last.
  painted.reverse();
  fills.push(...painted);
  return fills;
}

function scaleOf(size: string): 'fill' | 'fit' {
  return size.trim().toLowerCase() === 'contain' ? 'fit' : 'fill';
}

function urlIn(layer: string): string | null {
  const match = /^url\((['"]?)([\s\S]*?)\1\)$/i.exec(layer.trim());
  return match?.[2] ?? null;
}

/** Split a comma separated background list, respecting brackets. */
function splitLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter((part) => part.length > 0);
}

// ------------------------------------------------------------------ stroke

/**
 * A border.
 *
 * Figma has one stroke for a frame and CSS has four sides. When the sides
 * differ the thickest visible one is used and the run says so, once. The
 * `border-style` shorthand is read first: on a page where most elements have
 * no border at all, that is one property read instead of twelve.
 */
export function strokeOf(
  style: CSSStyleDeclaration,
  warnings: Warnings,
  nodeId: string,
): Stroke | undefined {
  const shorthand = read(style, 'border-style');
  if (shorthand === 'none' || shorthand === 'hidden') return undefined;

  const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
    width: Number.parseFloat(read(style, `border-${side}-width`)) || 0,
    color: read(style, `border-${side}-color`),
    line: read(style, `border-${side}-style`),
  }));

  const visible = sides.filter(
    (side) => side.width > 0 && side.line !== 'none' && side.line !== 'hidden',
  );
  if (visible.length === 0) return undefined;

  const thickest = visible.reduce((a, b) => (b.width > a.width ? b : a));
  const parsed = parseColor(thickest.color, { currentColor: read(style, 'color') });
  if (!parsed || parsed.opacity <= 0) return undefined;

  const uniform =
    visible.length === 4 &&
    visible.every((side) => side.width === thickest.width && side.color === thickest.color);
  if (!uniform) {
    warnings.add(
      'non-uniform-border',
      'the sides of a border differ, the thickest one was used for the whole stroke',
      { node: nodeId },
    );
  }

  return { color: parsed.color, opacity: parsed.opacity, weight: thickest.width, align: 'inside' };
}

// ------------------------------------------------------------------ radius

/** Nothing rounded: the shorthand a browser gives a square box. */
const SQUARE = /^0(?:px)?(?:\s+0(?:px)?)*$/;

/**
 * The four corners.
 *
 * Each corner is read on its own rather than from the shorthand, because what
 * `getComputedStyle` returns for `border-radius` differs between engines. An
 * elliptical corner - `60px / 24px` - keeps the horizontal radius, and every
 * corner is clamped to half the shorter side, which is where the browser lands
 * too. The shorthand is still read first, to skip the four reads on a box that
 * has no radius at all.
 */
export function radiusOf(
  style: CSSStyleDeclaration,
  box: Box,
  viewport: Viewport,
): Corners | undefined {
  const shorthand = read(style, 'border-radius');
  if (shorthand === '' || SQUARE.test(shorthand)) return undefined;

  const ctx = lengthContextOf(style, viewport);
  const size = { w: box.w, h: box.h };
  const corners: Corners = [
    mapRadius(read(style, 'border-top-left-radius'), size, ctx)[0],
    mapRadius(read(style, 'border-top-right-radius'), size, ctx)[0],
    mapRadius(read(style, 'border-bottom-right-radius'), size, ctx)[0],
    mapRadius(read(style, 'border-bottom-left-radius'), size, ctx)[0],
  ];
  return corners.every((corner) => corner === 0) ? undefined : corners;
}

// ----------------------------------------------------------------- effects

/** What a frame's own style draws: shadow, blur, backdrop blur. */
export function effectsOf(style: CSSStyleDeclaration, viewport: Viewport): Effect[] {
  const shadow = read(style, 'box-shadow');
  const filter = read(style, 'filter');
  const backdrop = read(style, 'backdrop-filter') || read(style, '-webkit-backdrop-filter');
  if (isNothing(shadow) && isNothing(filter) && isNothing(backdrop)) return [];

  const ctx = { ...lengthContextOf(style, viewport), currentColor: read(style, 'color') };
  return [
    ...(isNothing(shadow) ? [] : mapBoxShadow(shadow, ctx)),
    ...(isNothing(filter) ? [] : mapFilter(filter)),
    ...(isNothing(backdrop) ? [] : mapBackdropFilter(backdrop)),
  ];
}

/** What a run of text draws on top of the glyphs. */
export function textEffectsOf(style: CSSStyleDeclaration, viewport: Viewport): Effect[] {
  const shadow = read(style, 'text-shadow');
  if (isNothing(shadow)) return [];
  const ctx = { ...lengthContextOf(style, viewport), currentColor: read(style, 'color') };
  return mapTextShadow(shadow, ctx);
}

// ------------------------------------------------------------------ layout

export interface LayoutFor {
  layout: Layout | null;
  /** A grid that became a row: every child is this wide. */
  track?: number;
  /** What could not be kept exactly. Raised once the outcome is known. */
  notes: string[];
}

export function layoutFor(style: CSSStyleDeclaration, viewport: Viewport): LayoutFor {
  const result = mapLayout(computedOf(style), lengthContextOf(style, viewport));
  const out: LayoutFor = { layout: result.layout, notes: result.notes };
  if (result.track !== undefined) out.track = result.track;
  return out;
}

export function paddingOf(style: CSSStyleDeclaration, viewport: Viewport): Padding {
  return mapPadding(computedOf(style), lengthContextOf(style, viewport));
}

/** Does this element hold its text away from its own edges? */
export function hasPadding(style: CSSStyleDeclaration): boolean {
  const shorthand = read(style, 'padding');
  if (shorthand !== '' && SQUARE.test(shorthand)) return false;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if ((Number.parseFloat(read(style, `padding-${side}`)) || 0) > 0) return true;
  }
  return false;
}

/** Where a wrapping row of text runs starts, from how the page aligned them. */
export function justifyOf(style: CSSStyleDeclaration): LayoutJustify {
  switch (read(style, 'text-align')) {
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'end';
    default:
      return 'start';
  }
}

/** What the browser's own boxes say about how a child was sized. */
export interface Stretch {
  /** The child's border box. */
  box: Box;
  /** The parent's content box, the space its children were laid out in. */
  parentContent: Box | null;
}

/**
 * How a child sizes itself inside its parent's auto layout.
 *
 * `mapSizing` reads the declared width and height, but a browser's computed
 * style gives the used value: a child stretched by `align-items: stretch` says
 * `height: 820px`, which reads as a fixed height when it is really a fill. The
 * boxes settle it - a child whose cross axis exactly matches its parent's
 * content box was stretched to it - and the boxes are what the extractor is
 * for.
 */
export function sizingFor(
  style: CSSStyleDeclaration,
  viewport: Viewport,
  parent: Layout | null,
  stretch?: Stretch,
): Sizing {
  const sizing = mapSizing(computedOf(style), {
    ...lengthContextOf(style, viewport),
    ...(parent ? { parentMode: parent.mode, parentAlign: parent.align } : {}),
  });

  if (!parent || !stretch?.parentContent) return sizing;
  if (alignSelfOf(style, parent) !== 'stretch') return sizing;

  const { box, parentContent } = stretch;
  if (parent.mode === 'row' && Math.abs(box.h - parentContent.h) < 0.5) sizing.h = 'fill';
  if (parent.mode === 'column' && Math.abs(box.w - parentContent.w) < 0.5) sizing.w = 'fill';
  return sizing;
}

function alignSelfOf(style: CSSStyleDeclaration, parent: Layout): Layout['align'] {
  const self = read(style, 'align-self').toLowerCase();
  if (self === '' || self === 'auto' || self === 'normal') return parent.align;
  if (self === 'stretch') return 'stretch';
  if (self === 'center') return 'center';
  if (self === 'flex-start' || self === 'start' || self === 'self-start') return 'start';
  if (self === 'flex-end' || self === 'end' || self === 'self-end') return 'end';
  return parent.align;
}

// -------------------------------------------------------------------- text

export function textStyleFor(
  content: string,
  style: CSSStyleDeclaration,
  viewport: Viewport,
): TextStyle {
  return mapTextStyle(content, computedOf(style), textContextOf(style, viewport));
}

// -------------------------------------------------------------------- misc

export function opacityOf(style: CSSStyleDeclaration): number {
  const raw = read(style, 'opacity');
  // An engine that does not compute a property hands back an empty string, and
  // Number('') is 0, which would quietly drop every element on the page.
  if (raw === '' || raw === 'initial' || raw === 'unset') return 1;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

/**
 * Does this element clip what overflows it?
 *
 * The shorthand answers for the overwhelming majority of elements in one read;
 * the longhands are only needed when the two axes differ, which is when the
 * shorthand comes back empty or with two words.
 */
export function clipsOf(style: CSSStyleDeclaration): boolean {
  const clipping = (value: string): boolean =>
    value === 'hidden' || value === 'scroll' || value === 'auto' || value === 'clip';

  const shorthand = read(style, 'overflow');
  if (shorthand === 'visible') return false;
  if (shorthand !== '' && !shorthand.includes(' ')) return clipping(shorthand);

  return clipping(read(style, 'overflow-x')) || clipping(read(style, 'overflow-y'));
}
