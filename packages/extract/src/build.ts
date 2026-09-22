import type { Layout, Node, Paint } from '@fit-to-figma/tree';
import type { AssetRef, Assets } from './assets.js';
import { parseDataUrl } from './assets.js';
import type { Fonts } from './fonts.js';
import type { Box } from './geometry.js';
import { boxFromRect, intersect, isEmpty, round, roundBox } from './geometry.js';
import type { Ids } from './ids.js';
import { nameOf, semanticOf } from './semantic.js';
import type { LayoutFor, Viewport } from './style.js';
import {
  clipsOf,
  effectsOf,
  fillsOf,
  hasPadding,
  justifyOf,
  layoutFor,
  opacityOf,
  paddingOf,
  radiusOf,
  read,
  sizingFor,
  strokeOf,
  textEffectsOf,
  textStyleFor,
} from './style.js';
import { serialiseSvg } from './svg.js';
import type { PseudoScan, PseudoText } from './text.js';
import {
  controlText,
  directRuns,
  hasDirectText,
  looksLikeIcon,
  pseudoBox,
  pseudoTexts,
} from './text.js';
import type { Warnings } from './warnings.js';

/**
 * The walk.
 *
 * One pass over the DOM from the root the caller gave, producing nodes in
 * paint order. The rules the doc sets live here, including the five decisions
 * the first fixtures forced:
 *
 * - An element that paints or has padding and holds text is a frame with one
 *   text child, because Figma text carries no background and no padding.
 * - An element that paints nothing and has no padding is that text node.
 * - A mixed-run element keeps its wrapper, as a row that wraps, so the runs
 *   reflow together.
 * - Wrapper chains are never collapsed: three nested divs are three nodes.
 * - Hidden is display none, visibility hidden, opacity 0, zero size after
 *   layout, or a box entirely outside the root. A child entirely outside a
 *   scroll container's visible box goes with it; one partly inside is kept
 *   whole and the container clips.
 */

/** Tags the browser never draws. */
const NOT_DRAWN = new Set([
  'head',
  'meta',
  'link',
  'title',
  'script',
  'style',
  'noscript',
  'template',
  'source',
  'track',
  'param',
  'base',
  'br',
  'wbr',
  'option',
  'optgroup',
  'datalist',
  'map',
  'area',
  'col',
  'colgroup',
]);

/** Tags whose insides are an asset, not more nodes. */
const MEDIA = new Set(['svg', 'img', 'canvas', 'video', 'iframe', 'object', 'embed']);

const PLACEHOLDER: Paint = { type: 'solid', color: '#e8e6ea', opacity: 1 };

export interface BuildContext {
  root: Element;
  /** The root's border box in viewport coordinates: every box is relative to it. */
  origin: { x: number; y: number };
  view: Window;
  ids: Ids;
  assets: Assets;
  fonts: Fonts;
  warnings: Warnings;
  viewport: Viewport;
  includeHidden: boolean;
  maxDepth: number;
  pseudo: PseudoScan;
}

export interface Frame {
  /** What the children of this element are clipped to. */
  clip: Box;
  depth: number;
  /** The parent's auto layout, which decides how a child fills or hugs. */
  parentLayout: Layout | null;
  /** The parent's content box, for reading a stretched child off the boxes. */
  parentContent: Box | null;
  /**
   * Where this element sits in the DOM, from the root. Carried down rather
   * than walked up: recomputing it per node is quadratic on a wide list, and a
   * page of 1,500 siblings is exactly where that shows.
   */
  path: string;
}

/** The node or nodes an element becomes. May be none. */
export async function buildElement(
  el: Element,
  ctx: BuildContext,
  frame: Frame,
): Promise<Node[]> {
  const tag = el.tagName.toLowerCase();
  if (NOT_DRAWN.has(tag)) return [];

  const style = ctx.view.getComputedStyle(el);
  const display = read(style, 'display');

  // `display: contents` has no box: the children are laid out as if the
  // element were not there, so that is what the tree says too.
  if (display === 'contents') return buildChildren(el, ctx, frame, style, null, null);

  if (display === 'none' && !ctx.includeHidden) return [];

  const visibility = read(style, 'visibility');
  const hidden = visibility === 'hidden' || visibility === 'collapse';
  const opacity = opacityOf(style);
  const rect = el.getBoundingClientRect();
  const box = boxFromRect(rect, ctx.origin);

  if (!ctx.includeHidden) {
    // Hidden takes the subtree with it, and so does a box that sits entirely
    // outside what can be seen: everything laid out inside it is outside too.
    if (hidden || opacity === 0) return [];
    if (isEmpty(intersect(box, frame.clip))) {
      // A box with no size of its own is the exception. It draws nothing, but
      // what it contains may still be on screen, so the children come up to
      // the parent rather than disappearing with a wrapper that was never
      // visible in the first place.
      if (isEmpty(box) && !clipsOf(style) && !MEDIA.has(tag)) {
        return buildChildren(el, ctx, frame, style, null, null);
      }
      return [];
    }
  }

  const id = ctx.ids.take(frame.path);
  noteTransform(style, ctx, id);

  // The box is the one the browser drew, whole. A child that hangs out of a
  // scroll container is not cropped here: the container carries `clip`, and
  // cropping would move the text inside it.
  const node: Node = { id, name: nameOf(el), type: 'frame', ...roundBox(box) };

  const media = MEDIA.has(tag) ? await mediaOf(el, tag, box, ctx, id) : null;
  if (media) {
    node.type = media.type;
    if (media.asset) node.asset = media.asset;
    if (media.fills) node.fills = media.fills;
  }

  await paint(node, el, style, box, ctx, id, media !== null);
  node.semantic = semanticOf(el, media?.src ? { src: media.src } : undefined);

  const own: LayoutFor = media ? { layout: null, notes: [] } : layoutFor(style, ctx.viewport);
  node.sizing = sizingFor(style, ctx.viewport, frame.parentLayout, {
    box,
    parentContent: frame.parentContent,
  });

  if (media) return [node];
  if (own.layout) node.layout = own.layout;

  if (frame.depth >= ctx.maxDepth) {
    for (const note of own.notes) ctx.warnings.add('layout-approximated', note, { node: id });
    if (el.children.length > 0 || hasDirectText(el)) {
      ctx.warnings.add(
        'max-depth-reached',
        `the walk stopped at depth ${ctx.maxDepth}, what is below it is not in the tree`,
        { node: id },
      );
    }
    return [node];
  }

  const padding = paddingBox(style, box);
  const innerClip = clipsOf(style) ? intersect(frame.clip, padding) : frame.clip;
  const runs = new Set<string>();

  const children = await buildChildren(
    el,
    ctx,
    {
      clip: innerClip,
      depth: frame.depth + 1,
      parentLayout: own.layout,
      parentContent: own.layout ? contentBox(style, padding) : null,
      path: frame.path,
    },
    style,
    own.track ?? null,
    runs,
  );

  reportLayout(node, own, children, ctx, id);

  if (children.length === 0) return [node];

  // One run of this element's own text, and nothing painted around it: the
  // element is the text node. Anything else keeps its frame, including a
  // wrapper whose single child is a text node of its own.
  const only = children[0];
  if (
    children.length === 1 &&
    only &&
    only.type === 'text' &&
    runs.has(only.id) &&
    !paintsOrPads(node, style)
  ) {
    return [asText(node, only)];
  }

  node.children = children;
  wrapRuns(node, style, children, runs, ctx);
  return [node];
}

/**
 * The element is the text: its box and its semantic, the run's content, font
 * and name. Nothing about the layer list is tidied away - this is the one
 * element that held the words, and it keeps the element it was in .
 */
function asText(frame: Node, run: Node): Node {
  const merged: Node = { ...run };
  merged.x = frame.x;
  merged.y = frame.y;
  merged.w = frame.w;
  merged.h = frame.h;
  if (frame.semantic) merged.semantic = frame.semantic;
  if (frame.sizing) merged.sizing = frame.sizing;
  const opacity = round((frame.opacity ?? 1) * (run.opacity ?? 1));
  if (opacity < 1) merged.opacity = opacity;
  else delete merged.opacity;
  delete merged.children;
  return merged;
}

/** Does this frame draw anything of its own, or hold its text off its edges? */
function paintsOrPads(node: Node, style: CSSStyleDeclaration): boolean {
  if (node.fills?.length || node.strokes || node.effects?.length || node.radius) return true;
  if (node.clip || node.layout) return true;
  return hasPadding(style);
}

/**
 * A mixed-run element keeps its wrapper, as a row that wraps.
 *
 * `<p>plain <b>bold</b> tail</p>` is three runs that reflow together on the
 * page; in Figma they reflow together in a wrapping row. An element that
 * already has a layout of its own keeps it.
 */
function wrapRuns(
  node: Node,
  style: CSSStyleDeclaration,
  children: Node[],
  runs: Set<string>,
  ctx: BuildContext,
): void {
  if (node.layout) return;
  if (children.length < 2) return;
  if (!children.every((child) => child.type === 'text')) return;
  if (!children.some((child) => runs.has(child.id))) return;

  node.layout = {
    mode: 'row',
    gap: 0,
    padding: paddingOf(style, ctx.viewport),
    align: 'start',
    justify: justifyOf(style),
    wrap: true,
  };
}

/**
 * A grid that became a row only wraps if the browser wrapped it.
 *
 * `mapLayout` cannot know: it has the tracks but not the width they had to fit
 * in. The extractor does - the children are laid out - so the rows the browser
 * drew settle it, and the note is worded to match what happened.
 */
function reportLayout(
  node: Node,
  own: LayoutFor,
  children: Node[],
  ctx: BuildContext,
  id: string,
): void {
  const track = own.track;
  if (track === undefined || !node.layout) {
    for (const note of own.notes) ctx.warnings.add('layout-approximated', note, { node: id });
    return;
  }

  const wrapped = rowsOf(children) > 1;
  node.layout.wrap = wrapped;

  for (const note of own.notes) {
    // The map package assumes a grid has to wrap; when it did not, say so in
    // the words of what actually happened rather than repeating the guess.
    if (/wrapping row/i.test(note) && !wrapped) continue;
    ctx.warnings.add('layout-approximated', note, { node: id });
  }
  if (!wrapped) {
    ctx.warnings.add(
      'layout-approximated',
      `a grid of equal tracks became a row that fits on one line; each child is ${track}px wide`,
      { node: id },
    );
  }
}

/** How many lines the children were drawn on. */
function rowsOf(children: Node[]): number {
  const tops: number[] = [];
  for (const child of children) {
    if (!tops.some((top) => Math.abs(top - child.y) < 0.5)) tops.push(child.y);
  }
  return tops.length;
}

/** The element's own text, its pseudo text and its element children, in order. */
async function buildChildren(
  el: Element,
  ctx: BuildContext,
  frame: Frame,
  style: CSSStyleDeclaration,
  track: number | null,
  runs: Set<string> | null,
): Promise<Node[]> {
  const out: Node[] = [];
  const base = frame.path;
  const own = runs ?? new Set<string>();

  const pseudo = ctx.pseudo.canHavePseudo(el)
    ? pseudoTexts(el, ctx.view, ctx.warnings, base)
    : [];
  const elementBox = pseudo.length > 0 ? boxFromRect(el.getBoundingClientRect(), ctx.origin) : null;

  for (const before of pseudo) {
    if (before.which !== '::before' || !elementBox) continue;
    const node = pseudoNode(el, before, elementBox, base, ctx, frame);
    if (node) {
      own.add(node.id);
      out.push(node);
    }
  }

  const value = controlText(el);
  if (value !== null) {
    const node = textNode({
      ctx,
      path: `${base}#value`,
      content: value,
      box: contentBox(style, paddingBox(style, boxFromRect(el.getBoundingClientRect(), ctx.origin))),
      style,
      name: `${nameOf(el)} value`,
      clip: frame.clip,
    });
    if (node) {
      own.add(node.id);
      out.push(node);
    }
  }

  const textRuns = hasDirectText(el)
    ? directRuns({ el, origin: ctx.origin, view: ctx.view, warnings: ctx.warnings, nodeId: base })
    : [];
  let nextRun = 0;

  // One pass for the child element indices: walking back up to work out where
  // a child sits among its siblings is what makes a wide list quadratic.
  const seen = new Map<string, number>();

  for (let i = 0; i < el.childNodes.length; i += 1) {
    const child = el.childNodes[i];
    if (!child) continue;

    if (child.nodeType === 3) {
      const run = textRuns[nextRun];
      if (run && run.key === `#t${i}`) {
        nextRun += 1;
        const node = textNode({
          ctx,
          path: `${base}${run.key}`,
          content: run.content,
          box: run.box,
          lines: run.lines,
          style,
          name: nameOf(el),
          clip: frame.clip,
        });
        if (node) {
          own.add(node.id);
          out.push(node);
        }
      }
      continue;
    }

    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const tag = element.tagName.toLowerCase();
    const index = seen.get(tag) ?? 0;
    seen.set(tag, index + 1);
    const path = base === '' ? `${tag}:${index}` : `${base}/${tag}:${index}`;
    out.push(...(await buildElement(element, ctx, { ...frame, path })));
  }

  for (const after of pseudo) {
    if (after.which !== '::after' || !elementBox) continue;
    const node = pseudoNode(el, after, elementBox, base, ctx, frame);
    if (node) {
      own.add(node.id);
      out.push(node);
    }
  }

  // A grid that became a row keeps its columns by pinning every child's width.
  if (track !== null) {
    for (const child of out) child.sizing = { w: 'fixed', h: child.sizing?.h ?? 'hug' };
  }

  return out;
}

function pseudoNode(
  el: Element,
  pseudo: PseudoText,
  elementBox: Box,
  base: string,
  ctx: BuildContext,
  frame: Frame,
): Node | null {
  return textNode({
    ctx,
    path: `${base}${pseudo.which}`,
    content: pseudo.content,
    box: pseudoBox(el, pseudo, elementBox, ctx.view, ctx.warnings, base),
    style: pseudo.style,
    name: `${nameOf(el)}${pseudo.which}`,
    clip: frame.clip,
  });
}

// -------------------------------------------------------------------- text

interface TextNodeArgs {
  ctx: BuildContext;
  path: string;
  content: string;
  box: Box;
  style: CSSStyleDeclaration;
  name: string;
  clip: Box;
  /** Line boxes the run was drawn on, when something measured it. */
  lines?: number;
}

/** A run of text, or nothing when the run is outside what can be seen. */
function textNode(args: TextNodeArgs): Node | null {
  const { ctx, style } = args;
  if (!ctx.includeHidden && isEmpty(intersect(args.box, args.clip))) return null;

  const text = textStyleFor(args.content, style, ctx.viewport);
  // The plugin needs to know a one line run from a wrapped one: Figma's metrics
  // are not the browser's, and a line that only just fitted here would wrap there.
  if (typeof args.lines === 'number' && args.lines >= 1) text.lines = Math.round(args.lines);
  ctx.fonts.seen(text.font);

  if (looksLikeIcon(args.content, text.font.family)) {
    ctx.warnings.add(
      'icon-font',
      'an icon drawn by a font stays text, it needs that font in Figma to look right',
      { detail: text.font.family },
    );
  }

  const node: Node = {
    id: ctx.ids.take(args.path),
    // A text layer is called after the words in it. Which element held them is
    // in `semantic`, which is what the plugin matches components on.
    name: shortName(args.name, args.content),
    type: 'text',
    ...roundBox(args.box),
    text,
  };

  const effects = textEffectsOf(style, ctx.viewport);
  if (effects.length > 0) node.effects = effects;

  const opacity = opacityOf(style);
  if (opacity < 1) node.opacity = opacity;

  return node;
}

/** The words, tidied for a layer list; the element's name when there are none. */
function shortName(fallback: string, content: string): string {
  const words = content.trim().replace(/\s+/g, ' ');
  if (words.length === 0) return fallback;
  return words.length > 40 ? words.slice(0, 39) + '…' : words;
}

// ------------------------------------------------------------------- paint

async function paint(
  node: Node,
  el: Element,
  style: CSSStyleDeclaration,
  box: Box,
  ctx: BuildContext,
  id: string,
  isMedia: boolean,
): Promise<void> {
  if (!isMedia) {
    const fills = await fillsOf({
      style,
      box,
      viewport: ctx.viewport,
      resolveImage: async (url) => {
        const ref = await ctx.assets.addUrl(absolute(url, el), { w: box.w, h: box.h }, id);
        return ref?.id ?? null;
      },
      warnings: ctx.warnings,
      nodeId: id,
    });
    if (fills.length > 0) node.fills = fills;
  }

  const stroke = strokeOf(style, ctx.warnings, id);
  if (stroke) node.strokes = stroke;

  const radius = radiusOf(style, box, ctx.viewport);
  if (radius) node.radius = radius;

  const effects = effectsOf(style, ctx.viewport);
  if (effects.length > 0) node.effects = effects;

  const opacity = opacityOf(style);
  if (opacity < 1) node.opacity = opacity;

  if (clipsOf(style)) node.clip = true;
}

// ------------------------------------------------------------------- media

interface Media {
  type: Node['type'];
  asset?: string;
  fills?: Paint[];
  /** Where it came from, when the bytes could not be inlined. */
  src?: string;
}

async function mediaOf(
  el: Element,
  tag: string,
  box: Box,
  ctx: BuildContext,
  id: string,
): Promise<Media | null> {
  switch (tag) {
    case 'svg':
      return svgMedia(el as unknown as SVGSVGElement, box, ctx, id);
    case 'img':
      return imageMedia(el as HTMLImageElement, box, ctx, id);
    case 'canvas':
      return canvasMedia(el as HTMLCanvasElement, box, ctx, id);
    case 'video':
      return videoMedia(el as HTMLVideoElement, box, ctx, id);
    default:
      ctx.warnings.add(
        'iframe-skipped',
        'an embedded document cannot be read from the page, an empty frame stands in for it',
        { detail: tag, node: id },
      );
      return { type: 'frame', fills: [PLACEHOLDER] };
  }
}

function svgMedia(el: SVGSVGElement, box: Box, ctx: BuildContext, id: string): Media {
  const serialised = serialiseSvg({
    svg: el,
    size: { w: box.w, h: box.h },
    warnings: ctx.warnings,
    nodeId: id,
  });
  const ref = ctx.assets.addSvg(serialised.markup, { w: serialised.w, h: serialised.h });
  return assetOrPlaceholder('vector', ref);
}

async function imageMedia(
  el: HTMLImageElement,
  box: Box,
  ctx: BuildContext,
  id: string,
): Promise<Media> {
  const src = el.currentSrc || el.getAttribute('src') || '';
  if (!src) return { type: 'image', fills: [PLACEHOLDER] };
  const url = absolute(src, el);
  const hint = { w: el.naturalWidth || box.w, h: el.naturalHeight || box.h };
  const ref = await ctx.assets.addUrl(url, hint, id);
  return assetOrPlaceholder('image', ref, url);
}

async function canvasMedia(
  el: HTMLCanvasElement,
  box: Box,
  ctx: BuildContext,
  id: string,
): Promise<Media> {
  try {
    const parsed = parseDataUrl(el.toDataURL('image/png'));
    if (!parsed) throw new Error('nothing came back');
    const ref = ctx.assets.addBase64(parsed.base64, parsed.mime, {
      w: el.width || box.w,
      h: el.height || box.h,
    });
    return assetOrPlaceholder('image', ref);
  } catch {
    ctx.warnings.add(
      'canvas-tainted',
      'a canvas has cross-origin content drawn on it, so its pixels could not be read',
      { node: id },
    );
    return { type: 'image', fills: [PLACEHOLDER] };
  }
}

async function videoMedia(
  el: HTMLVideoElement,
  box: Box,
  ctx: BuildContext,
  id: string,
): Promise<Media> {
  const w = el.videoWidth || box.w;
  const h = el.videoHeight || box.h;
  try {
    if (el.readyState >= 2 && w > 0 && h > 0) {
      const canvas = el.ownerDocument.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('no 2d context');
      context.drawImage(el, 0, 0, w, h);
      const parsed = parseDataUrl(canvas.toDataURL('image/png'));
      if (!parsed) throw new Error('nothing came back');
      const ref = ctx.assets.addBase64(parsed.base64, parsed.mime, { w, h });
      if (ref) return { type: 'image', asset: ref.id };
    }
  } catch {
    // The poster is the next best thing.
  }

  const poster = el.getAttribute('poster');
  if (poster) {
    const ref = await ctx.assets.addUrl(absolute(poster, el), { w, h }, id);
    if (ref) return { type: 'image', asset: ref.id };
  }

  ctx.warnings.add(
    'video-frame-unavailable',
    'a video had no frame the page would hand over, a placeholder stands in for it',
    { node: id },
  );
  return { type: 'image', fills: [PLACEHOLDER] };
}

function assetOrPlaceholder(type: Node['type'], ref: AssetRef | null, src?: string): Media {
  if (ref) return { type, asset: ref.id };
  const media: Media = { type, fills: [PLACEHOLDER] };
  if (src) media.src = src;
  return media;
}

// ------------------------------------------------------------------- boxes

function absolute(url: string, el: Element): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url;
  const base = el.ownerDocument?.baseURI;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

/** The border box less the borders: what `overflow` clips to. */
function paddingBox(style: CSSStyleDeclaration, box: Box): Box {
  const top = px(style, 'border-top-width');
  const right = px(style, 'border-right-width');
  const bottom = px(style, 'border-bottom-width');
  const left = px(style, 'border-left-width');
  return {
    x: box.x + left,
    y: box.y + top,
    w: Math.max(0, box.w - left - right),
    h: Math.max(0, box.h - top - bottom),
  };
}

/** The padding box less the padding: the space the children were laid out in. */
function contentBox(style: CSSStyleDeclaration, padding: Box): Box {
  const top = px(style, 'padding-top');
  const right = px(style, 'padding-right');
  const bottom = px(style, 'padding-bottom');
  const left = px(style, 'padding-left');
  return {
    x: padding.x + left,
    y: padding.y + top,
    w: Math.max(0, padding.w - left - right),
    h: Math.max(0, padding.h - top - bottom),
  };
}

function px(style: CSSStyleDeclaration, property: string): number {
  return Number.parseFloat(read(style, property)) || 0;
}

/**
 * Figma has no rotation or skew on a frame, so a transformed element keeps the
 * box the browser gave it and the run says the angle was not carried.
 */
function noteTransform(style: CSSStyleDeclaration, ctx: BuildContext, id: string): void {
  const transform = read(style, 'transform');
  if (!transform || transform === 'none') return;
  // matrix(a, b, c, d, e, f): b and c are zero for a pure translate or scale.
  const match = /^matrix\(([^)]+)\)$/.exec(transform);
  if (match?.[1]) {
    const parts = match[1].split(',').map((part) => Number(part.trim()));
    if (Math.abs(parts[1] ?? 0) < 1e-6 && Math.abs(parts[2] ?? 0) < 1e-6) return;
  }
  ctx.warnings.add(
    'transform-ignored',
    'an element is rotated or skewed, its box is the one the browser drew and the angle is lost',
    { node: id },
  );
}
