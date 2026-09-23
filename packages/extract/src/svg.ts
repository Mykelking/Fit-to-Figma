import type { Warnings } from './warnings.js';

/**
 * Inline SVG to a self contained vector asset.
 *
 * The plugin gets markup that stands on its own: no `currentColor` left to
 * inherit, no `<use href="#sprite-id">` pointing at a sprite the plugin never
 * sees, and the paint the stylesheet applied written onto the elements. What
 * goes in the asset is what the browser drew.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Painted properties worth carrying, each with the value SVG assumes when the
 * attribute is absent. Values are written in the form an attribute takes, so
 * the initials are given that way too.
 */
const PAINT_PROPERTIES: Array<[property: string, initial: string]> = [
  ['fill', '#000000'],
  ['fill-opacity', '1'],
  ['fill-rule', 'nonzero'],
  ['stroke', 'none'],
  ['stroke-width', '1'],
  ['stroke-opacity', '1'],
  ['stroke-linecap', 'butt'],
  ['stroke-linejoin', 'miter'],
  ['stroke-miterlimit', '4'],
  ['stroke-dasharray', 'none'],
  ['stroke-dashoffset', '0'],
  ['opacity', '1'],
  ['mix-blend-mode', 'normal'],
];

/** The painted properties an element passes down to its children. */
const INHERITED = PAINT_PROPERTIES.filter(([p]) => p !== 'opacity' && p !== 'mix-blend-mode');

/** What actually draws, and so has to carry its own paint. */
const DRAWN = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
]);

/** The ones that draw words, which carry the font as well. */
const TEXTUAL = new Set(['text', 'tspan', 'textpath']);

const TEXT_PROPERTIES: Array<[property: string, initial: string]> = [
  ['font-family', ''],
  ['font-size', ''],
  ['font-weight', ''],
  ['font-style', 'normal'],
  ['letter-spacing', 'normal'],
  ['text-anchor', 'start'],
  ['dominant-baseline', 'auto'],
];

export interface SerialisedSvg {
  markup: string;
  w: number;
  h: number;
}

export interface SerialiseSvgArgs {
  svg: SVGSVGElement;
  /** The box the browser gave the element, in CSS pixels. */
  size: { w: number; h: number };
  warnings: Warnings;
  nodeId: string;
}

export function serialiseSvg({ svg, size, warnings, nodeId }: SerialiseSvgArgs): SerialisedSvg {
  const clone = svg.cloneNode(true) as SVGSVGElement;

  const currentColor = computedColor(svg);
  copyComputedPaint(svg, clone);
  inlineUses(svg, clone, currentColor, warnings, nodeId);
  replaceCurrentColor(clone, currentColor);
  resolveInherited(clone);
  scrub(clone);

  clone.setAttribute('xmlns', SVG_NS);
  if (usesXlink(clone)) clone.setAttribute('xmlns:xlink', XLINK_NS);

  const viewBox = clone.getAttribute('viewBox');
  if (!viewBox && size.w > 0 && size.h > 0) {
    clone.setAttribute('viewBox', `0 0 ${size.w} ${size.h}`);
  }
  clone.setAttribute('width', String(size.w));
  clone.setAttribute('height', String(size.h));

  return { markup: serialise(clone), w: size.w, h: size.h };
}

function computedColor(el: Element): string {
  const view = el.ownerDocument?.defaultView;
  if (!view) return 'rgb(0, 0, 0)';
  return view.getComputedStyle(el).color || 'rgb(0, 0, 0)';
}

/**
 * Write what the stylesheet said onto the elements themselves.
 *
 * The original and the clone have the same shape, so the two walks stay in
 * step. Elements the browser never laid out - a sprite in a `display: none`
 * block - have no useful computed style, and are left alone.
 */
function copyComputedPaint(original: Element, clone: Element): void {
  const view = original.ownerDocument?.defaultView;
  if (!view || typeof view.getComputedStyle !== 'function') return;

  const originals: Element[] = [original];
  const clones: Element[] = [clone];
  while (originals.length > 0) {
    const from = originals.pop()!;
    const to = clones.pop()!;
    applyComputed(view, from, to);
    const fromChildren = from.children;
    const toChildren = to.children;
    if (fromChildren.length !== toChildren.length) continue;
    for (let i = 0; i < fromChildren.length; i += 1) {
      const a = fromChildren[i];
      const b = toChildren[i];
      if (a && b) {
        originals.push(a);
        clones.push(b);
      }
    }
  }
}

function applyComputed(view: Window, from: Element, to: Element): void {
  let style: CSSStyleDeclaration;
  try {
    style = view.getComputedStyle(from);
  } catch {
    return;
  }
  if (!style || style.length === 0) return;

  const tag = from.tagName.toLowerCase();
  const wanted = TEXTUAL.has(tag) ? [...PAINT_PROPERTIES, ...TEXT_PROPERTIES] : PAINT_PROPERTIES;

  // Attributes, not a style attribute: the plugin reads SVG, not CSS.
  for (const [property, initial] of wanted) {
    const raw = style.getPropertyValue(property);
    const value = clean(property, raw);
    if (value === '' || value === initial) continue;
    write(to, property, value, alphaOf(raw));
  }
}

/**
 * One value, in the form an attribute takes: a colour as `#rrggbb`, a length
 * without its unit, anything else as it came.
 */
function clean(property: string, raw: string): string {
  const value = (raw ?? '').trim();
  if (value === '') return '';
  const colour = toHex(value);
  if (colour) return colour.hex;
  const length = /^(-?\d*\.?\d+)px$/.exec(value);
  return length && length[1] !== undefined ? length[1] : value;
}

/** `rgb()` and `rgba()` as the browser computes them, and plain hex. */
function toHex(value: string): { hex: string; alpha: number } | null {
  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short && short[1]) {
    const s = short[1];
    return { hex: '#' + s.split('').map((c) => c + c).join('').toLowerCase(), alpha: 1 };
  }
  if (/^#[0-9a-f]{6}$/i.test(value)) return { hex: value.toLowerCase(), alpha: 1 };

  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (!rgb || rgb[1] === undefined) return null;
  const parts = rgb[1].split(/[,/\s]+/).filter((p) => p !== '');
  const channel = (at: number): number => {
    const n = Number.parseFloat(parts[at] ?? '0');
    return Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0;
  };
  const two = (n: number): string => n.toString(16).padStart(2, '0');
  const alpha = parts.length > 3 ? Number.parseFloat(parts[3] ?? '1') : 1;
  return {
    hex: '#' + two(channel(0)) + two(channel(1)) + two(channel(2)),
    alpha: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
  };
}

/** Writes one property, splitting a see-through colour off into its opacity. */
function write(el: Element, property: string, value: string, alpha = 1): void {
  el.setAttribute(property, value);
  if (alpha < 1 && (property === 'fill' || property === 'stroke')) {
    el.setAttribute(property + '-opacity', String(Math.round(alpha * 1000) / 1000));
  }
}

function alphaOf(raw: string): number {
  const colour = toHex((raw ?? '').trim());
  return colour ? colour.alpha : 1;
}

/**
 * Push the paint down to the things that draw.
 *
 * An inlined symbol was never laid out on the page, so nothing computed its
 * paint: it takes it from the `<use>` site, the way the browser would have.
 * After this every drawn element says what it is painted with, and the asset
 * no longer depends on a stylesheet, on `currentColor` or on its ancestors.
 */
function resolveInherited(root: Element): void {
  const walk = (el: Element, from: Map<string, string>): void => {
    const here = new Map(from);
    const drawn = DRAWN.has(el.tagName.toLowerCase());
    for (const [property, initial] of INHERITED) {
      const own = clean(property, el.getAttribute(property) ?? styleOf(el, property));
      const value = own !== '' ? own : here.get(property) ?? '';
      if (value === '') continue;
      here.set(property, value);
      if (drawn && value !== initial) el.setAttribute(property, value);
    }
    for (const child of Array.from(el.children)) walk(child, here);
  };
  walk(root, new Map());
}

function styleOf(el: Element, property: string): string {
  const style = (el as unknown as { style?: CSSStyleDeclaration }).style;
  try {
    return style?.getPropertyValue(property) ?? '';
  } catch {
    return '';
  }
}

/**
 * Replace every `<use>` with the thing it points at.
 *
 * A `<symbol>` becomes a nested `<svg>` so its own `viewBox` still scales the
 * content; anything else is cloned in place. The `<use>`'s x, y and painted
 * attributes go onto a wrapper so the drawing does not move.
 */
function inlineUses(
  originalSvg: SVGSVGElement,
  clone: SVGSVGElement,
  currentColor: string,
  warnings: Warnings,
  nodeId: string,
): void {
  const doc = originalSvg.ownerDocument;
  // Bounded: a symbol that uses itself would otherwise never finish.
  for (let pass = 0; pass < 8; pass += 1) {
    const uses = Array.from(clone.querySelectorAll('use'));
    if (uses.length === 0) return;
    let changed = false;

    for (const use of uses) {
      const href = use.getAttribute('href') ?? use.getAttributeNS(XLINK_NS, 'href') ?? '';
      const target = href.startsWith('#') && doc ? doc.getElementById(href.slice(1)) : null;
      if (!target) {
        warnings.add(
          'svg-use-unresolved',
          'an svg <use> pointed at something that is not in the document, it was dropped',
          { detail: href || '(no href)', node: nodeId },
        );
        use.remove();
        changed = true;
        continue;
      }

      const replacement = expand(use, target, clone.ownerDocument ?? document, currentColor);
      use.replaceWith(replacement);
      changed = true;
    }

    if (!changed) return;
  }
  warnings.add(
    'svg-use-unresolved',
    'an svg <use> chain was too deep to inline and was left partly unresolved',
    { node: nodeId },
  );
}

function expand(use: Element, target: Element, doc: Document, currentColor: string): Element {
  const group = doc.createElementNS(SVG_NS, 'g');

  const x = Number(use.getAttribute('x') ?? '0') || 0;
  const y = Number(use.getAttribute('y') ?? '0') || 0;
  const transform = use.getAttribute('transform');
  const moves = [transform, x !== 0 || y !== 0 ? `translate(${x} ${y})` : null].filter(Boolean);
  if (moves.length > 0) group.setAttribute('transform', moves.join(' '));

  // The paint on the <use> is what the symbol inherits.
  const useStyleDeclaration = (use as unknown as { style?: CSSStyleDeclaration }).style;
  for (const [property] of PAINT_PROPERTIES) {
    const own = use.getAttribute(property) ?? useStyleDeclaration?.getPropertyValue(property) ?? '';
    const raw = own === 'currentColor' ? currentColor : own;
    const value = clean(property, raw);
    if (value !== '') write(group, property, value, alphaOf(raw));
  }
  const useStyle = use.getAttribute('style');
  if (useStyle) group.setAttribute('style', useStyle.replace(/currentColor/g, currentColor));

  const copy = target.cloneNode(true) as Element;
  if (copy.tagName.toLowerCase() === 'symbol') {
    const nested = doc.createElementNS(SVG_NS, 'svg');
    for (const name of ['viewBox', 'preserveAspectRatio']) {
      const value = copy.getAttribute(name);
      if (value) nested.setAttribute(name, value);
    }
    const width = use.getAttribute('width');
    const height = use.getAttribute('height');
    nested.setAttribute('width', width ?? '100%');
    nested.setAttribute('height', height ?? '100%');
    while (copy.firstChild) nested.appendChild(copy.firstChild);
    group.appendChild(nested);
  } else {
    // A plain target keeps its own size unless the <use> overrode it.
    for (const name of ['width', 'height']) {
      const value = use.getAttribute(name);
      if (value) copy.setAttribute(name, value);
    }
    group.appendChild(copy);
  }

  // Inlined content would otherwise repeat ids that are already in the page.
  dropIds(group);
  return group;
}

function dropIds(root: Element): void {
  if (root.hasAttribute('id')) root.removeAttribute('id');
  for (const el of Array.from(root.querySelectorAll('[id]'))) el.removeAttribute('id');
}

/** Anything still saying `currentColor` now says the colour it resolved to. */
function replaceCurrentColor(root: Element, color: string): void {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    const attributes = Array.from(el.attributes);
    for (const attribute of attributes) {
      if (attribute.value.includes('currentColor')) {
        el.setAttribute(attribute.name, attribute.value.replace(/currentColor/g, color));
      }
    }
  }
}

/** Nothing that runs, nothing that phones home, nothing left over from the page. */
function scrub(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('script, foreignObject'))) el.remove();
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attribute of Array.from(el.attributes)) {
      const name = attribute.name.toLowerCase();
      // A class hooks a stylesheet that is not coming, and data is the page's.
      if (name.startsWith('on') || name === 'class' || name.startsWith('data-')) {
        el.removeAttribute(attribute.name);
      }
    }
  }
}

/** Is there still an `xlink:href` anywhere, after the uses were inlined? */
function usesXlink(root: Element): boolean {
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attribute of Array.from(el.attributes)) {
      if (attribute.name.toLowerCase().startsWith('xlink:')) return true;
    }
  }
  return false;
}

function serialise(el: Element): string {
  if (typeof XMLSerializer === 'function') {
    try {
      return new XMLSerializer().serializeToString(el);
    } catch {
      // fall through
    }
  }
  return el.outerHTML;
}
