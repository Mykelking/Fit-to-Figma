import type { LinearPaint, Node, Paint, SolidPaint } from '@fit-to-figma/tree';
import type { Assets } from './assets.js';
import { atobSafe, mimeFromUrl, parseDataUrl } from './assets.js';
import type { Box } from './geometry.js';
import { round } from './geometry.js';
import type { Ids } from './ids.js';
import { read, splitLayers, urlIn } from './style.js';
import { serialiseSvg, tintSvg } from './svg.js';
import type { Warnings } from './warnings.js';

/**
 * CSS masks.
 *
 * `background-color: currentColor` under `mask-image: url(logo.svg)` is how a
 * page draws a logo or an icon in its own colour. The element's box paints
 * nothing a person would recognise: what shows is the mask's shape, filled
 * with the background. Figma has no CSS mask, so the shape is drawn for real:
 * an SVG mask becomes a vector painted with the background, a raster mask an
 * image recoloured to it, placed where `mask-size` and `mask-position` put it.
 */

export interface MaskArgs {
  el: Element;
  style: CSSStyleDeclaration;
  /** The element's border box, in root coordinates. */
  box: Box;
  /** What the element's background painted, bottom first. */
  fills: Paint[];
  assets: Assets;
  ids: Ids;
  warnings: Warnings;
  /** The element's own path, for the mask node's id. */
  path: string;
  nodeId: string;
}

/** What `mask-size` and `mask-position` make of a mask inside a box. */
export function placeMask(
  box: { w: number; h: number },
  natural: { w: number; h: number } | null,
  size: string,
  position: string,
): Box {
  const nw = natural && natural.w > 0 ? natural.w : box.w;
  const nh = natural && natural.h > 0 ? natural.h : box.h;
  const sized = sizeOf(box, nw, nh, size);
  const [px, py] = positionOf(position);
  return {
    x: round((box.w - sized.w) * px.pct + px.px),
    y: round((box.h - sized.h) * py.pct + py.px),
    w: round(sized.w),
    h: round(sized.h),
  };
}

function sizeOf(box: { w: number; h: number }, nw: number, nh: number, size: string): { w: number; h: number } {
  const tokens = size.trim().toLowerCase().split(/\s+/).filter((t) => t !== '');
  const first = tokens[0] ?? 'auto';
  if (first === 'contain' || first === 'cover') {
    const scale = (first === 'contain' ? Math.min : Math.max)(box.w / nw, box.h / nh);
    return { w: nw * scale, h: nh * scale };
  }
  const w = lengthOf(first, box.w);
  const h = tokens[1] !== undefined ? lengthOf(tokens[1], box.h) : null;
  // An auto side keeps the picture's own proportions.
  if (w === null && h === null) return { w: nw, h: nh };
  if (h === null) return { w: w as number, h: ((w as number) * nh) / nw };
  if (w === null) return { w: (h * nw) / nh, h };
  return { w, h };
}

function lengthOf(token: string, of: number): number | null {
  const px = /^(-?\d*\.?\d+)px$/.exec(token);
  if (px && px[1] !== undefined) return Number(px[1]);
  const pct = /^(-?\d*\.?\d+)%$/.exec(token);
  if (pct && pct[1] !== undefined) return (Number(pct[1]) * of) / 100;
  if (/^-?\d*\.?\d+$/.test(token)) return Number(token);
  return null;
}

/** One axis: a share of the free space plus a fixed offset, which reads calc() too. */
interface Offset {
  pct: number;
  px: number;
}

const CENTRE: Offset = { pct: 0.5, px: 0 };

const KEYWORDS: Record<string, Offset> = {
  left: { pct: 0, px: 0 },
  top: { pct: 0, px: 0 },
  center: CENTRE,
  right: { pct: 1, px: 0 },
  bottom: { pct: 1, px: 0 },
};

function positionOf(position: string): [Offset, Offset] {
  const tokens = (position.trim().toLowerCase().match(/calc\([^)]*\)|\S+/g) ?? []).slice(0, 2);
  const x = tokens[0] ? offsetOf(tokens[0]) : CENTRE;
  const y = tokens[1] ? offsetOf(tokens[1]) : CENTRE;
  // `top left` names the vertical first.
  if (tokens[0] === 'top' || tokens[0] === 'bottom' || tokens[1] === 'left' || tokens[1] === 'right') return [y, x];
  return [x, y];
}

function offsetOf(token: string): Offset {
  const keyword = KEYWORDS[token];
  if (keyword) return keyword;
  const calc = /^calc\((-?\d*\.?\d+)%\s*([+-])\s*(\d*\.?\d+)px\)$/.exec(token);
  if (calc && calc[1] !== undefined && calc[3] !== undefined) {
    return { pct: Number(calc[1]) / 100, px: (calc[2] === '-' ? -1 : 1) * Number(calc[3]) };
  }
  const pct = /^(-?\d*\.?\d+)%$/.exec(token);
  if (pct && pct[1] !== undefined) return { pct: Number(pct[1]) / 100, px: 0 };
  const px = /^(-?\d*\.?\d+)px$/.exec(token);
  if (px && px[1] !== undefined) return { pct: 0, px: Number(px[1]) };
  return CENTRE;
}

/**
 * A gradient that runs across the element's box, written for a drawing whose
 * user units put that box at `element`. The same line CSS draws: through the
 * centre at `angle`, long enough that the corners land on the end stops.
 */
export function gradientDef(paint: LinearPaint, element: Box, id: string): string {
  const rad = ((Number.isFinite(paint.angle) ? paint.angle : 180) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(element.w * dx) + Math.abs(element.h * dy)) / 2;
  const cx = element.x + element.w / 2;
  const cy = element.y + element.h / 2;
  const stops = paint.stops
    .map((s) => `<stop offset="${round(s.at)}" stop-color="${s.color}" stop-opacity="${round(s.opacity)}"/>`)
    .join('');
  return (
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `x1="${round(cx - dx * half)}" y1="${round(cy - dy * half)}" x2="${round(cx + dx * half)}" y2="${round(cy + dy * half)}">` +
    `${stops}</linearGradient>`
  );
}

/** The mask's first url, read from the standard property or the prefixed one. */
function maskOf(style: CSSStyleDeclaration): { url: string; prefix: string; layers: number } | null {
  for (const prefix of ['', '-webkit-']) {
    const value = read(style, `${prefix}mask-image`);
    if (value === '' || value === 'none') continue;
    const layers = splitLayers(value);
    const url = urlIn(layers[0] ?? '');
    return url ? { url, prefix, layers: layers.length } : null;
  }
  return null;
}

/**
 * The node an element's mask draws, or null when there is none to draw. The
 * caller drops the element's own background: the mask was all of it that
 * showed.
 */
export async function maskNode(args: MaskArgs): Promise<Node | null> {
  const mask = maskOf(args.style);
  if (!mask) return null;
  const { style, warnings, nodeId } = args;
  const property = (name: string): string => first(read(style, `${mask.prefix}${name}`));

  const tint = args.fills[args.fills.length - 1];
  if (!tint || tint.type === 'image') {
    warnings.add(
      'mask-approximated',
      'a mask over something other than a colour or a gradient is not drawn, the element keeps its box',
      { detail: 'no colour under the mask', node: nodeId },
    );
    return null;
  }

  approximations(args, mask.layers, property);

  const url = absolute(mask.url, args.el);
  const size = property('mask-size') || 'auto';
  const position =
    property('mask-position') ||
    `${property('mask-position-x') || '50%'} ${property('mask-position-y') || '50%'}`;
  const id = args.ids.take(`${args.path}#mask`);
  const name = `${args.el.tagName.toLowerCase()} mask`;

  try {
    const svg = await svgText(url);
    const made =
      svg !== null
        ? vectorMask(svg, args, tint, size, position)
        : await imageMask(url, args, tint, size, position);
    if (!made) return null;
    const node: Node = {
      id,
      name,
      type: made.type,
      x: round(args.box.x + made.at.x),
      y: round(args.box.y + made.at.y),
      w: made.at.w,
      h: made.at.h,
      asset: made.asset,
      // The shape sits where the mask put it, not where a layout would.
      flow: 'absolute',
    };
    const alpha = tint.type === 'solid' ? tint.opacity : 1;
    if (alpha < 1) node.opacity = round(alpha);
    return node;
  } catch (error) {
    warnings.add(
      'asset-fetch-failed',
      'a mask image could not be read from the page, the element keeps its box',
      { detail: `${shortUrl(url)}: ${(error as Error).message}`, node: nodeId },
    );
    return null;
  }
}

/** What Figma cannot do with a mask, said once each. */
function approximations(args: MaskArgs, layers: number, property: (name: string) => string): void {
  const say = (kind: string): void =>
    args.warnings.add(
      'mask-approximated',
      'a CSS mask was drawn as one shape, placed once, using its alpha',
      { detail: kind, node: args.nodeId },
    );
  if (layers > 1) say('more than one mask');
  const repeat = property('mask-repeat');
  if (repeat !== '' && !repeat.split(/\s+/).every((r) => r === 'no-repeat')) say('mask-repeat');
  const composite = property('mask-composite');
  if (composite !== '' && composite !== 'add' && composite !== 'source-over') say('mask-composite');
  if (property('mask-mode') === 'luminance') say('luminance mask');
}

interface Made {
  type: 'vector' | 'image';
  asset: string;
  at: Box;
}

function vectorMask(text: string, args: MaskArgs, tint: SolidPaint | LinearPaint, size: string, position: string): Made | null {
  const doc = args.el.ownerDocument;
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (!parsed || parsed.tagName.toLowerCase() !== 'svg') throw new Error('not an svg');

  // Mounted out of sight, in a shadow root so its own <style> cannot reach the
  // page, for long enough that the browser computes its paint.
  const host = doc.createElement('div');
  host.setAttribute('style', 'position:absolute;left:-100000px;top:0;width:0;height:0;overflow:hidden');
  doc.documentElement.appendChild(host);
  try {
    const shadow = host.attachShadow({ mode: 'open' });
    const svg = doc.importNode(parsed, true) as unknown as SVGSVGElement;
    shadow.appendChild(svg);

    const natural = naturalSize(svg);
    const viewBox = viewBoxOf(svg) ?? (natural ? { x: 0, y: 0, w: natural.w, h: natural.h } : null);
    if (viewBox && !svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${viewBox.w} ${viewBox.h}`);
    const at = placeMask(args.box, natural ?? viewBox, size, position);
    if (at.w <= 0 || at.h <= 0) return null;

    const serialised = serialiseSvg({ svg, size: { w: at.w, h: at.h }, warnings: args.warnings, nodeId: args.nodeId });
    let markup: string;
    if (tint.type === 'linear') {
      // The gradient runs across the element, so its box is put in the
      // drawing's own units: the view box fills the placed shape exactly.
      const vb = viewBox ?? { x: 0, y: 0, w: at.w, h: at.h };
      const sx = vb.w / at.w;
      const sy = vb.h / at.h;
      const element = { x: vb.x - at.x * sx, y: vb.y - at.y * sy, w: args.box.w * sx, h: args.box.h * sy };
      markup = tintSvg(serialised.markup, 'url(#fit-mask-tint)', gradientDef(tint, element, 'fit-mask-tint'));
    } else {
      markup = tintSvg(serialised.markup, tint.color);
    }
    const ref = args.assets.addSvg(markup, { w: at.w, h: at.h });
    return ref ? { type: 'vector', asset: ref.id, at } : null;
  } finally {
    host.remove();
  }
}

async function imageMask(url: string, args: MaskArgs, tint: SolidPaint | LinearPaint, size: string, position: string): Promise<Made | null> {
  let colour = tint.type === 'solid' ? tint.color : '#000000';
  if (tint.type === 'linear') {
    args.warnings.add(
      'mask-gradient-flattened',
      'a gradient under a raster mask was drawn in its first colour',
      { node: args.nodeId },
    );
    colour = tint.stops[0]?.color ?? colour;
  }

  const doc = args.el.ownerDocument;
  const image = doc.createElement('img');
  if (!url.startsWith('data:')) image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (!(w > 0 && h > 0)) return null;

  // The mask's alpha, filled with the colour: source-in keeps what was drawn.
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, w, h);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = colour;
  context.fillRect(0, 0, w, h);
  const parsed = parseDataUrl(canvas.toDataURL('image/png'));
  if (!parsed) return null;

  const at = placeMask(args.box, { w, h }, size, position);
  if (at.w <= 0 || at.h <= 0) return null;
  const ref = args.assets.addBase64(parsed.base64, parsed.mime, { w: at.w, h: at.h });
  return ref ? { type: 'image', asset: ref.id, at } : null;
}

/** The mask's markup when it is an SVG, or null when it is a picture. */
async function svgText(url: string): Promise<string | null> {
  if (url.startsWith('data:')) {
    const parsed = parseDataUrl(url);
    if (!parsed) throw new Error('unreadable data URL');
    if (parsed.mime !== 'image/svg+xml') return null;
    return parsed.text ?? atobSafe(parsed.base64);
  }
  if (mimeFromUrl(url) !== 'image/svg+xml') return null;
  const response = await fetch(url, { credentials: 'include', mode: 'cors' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function naturalSize(svg: SVGSVGElement): { w: number; h: number } | null {
  const w = Number.parseFloat(svg.getAttribute('width') ?? '');
  const h = Number.parseFloat(svg.getAttribute('height') ?? '');
  if (w > 0 && h > 0) return { w, h };
  const box = viewBoxOf(svg);
  return box ? { w: box.w, h: box.h } : null;
}

function viewBoxOf(svg: Element): Box | null {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts as [number, number, number, number];
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** The first layer of a list, which is the one this draws. */
function first(value: string): string {
  return (splitLayers(value)[0] ?? '').trim();
}

function absolute(url: string, el: Element): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url;
  const base = el.ownerDocument?.baseURI;
  try {
    return base ? new URL(url, base).href : url;
  } catch {
    return url;
  }
}

function shortUrl(url: string): string {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}
