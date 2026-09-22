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

/** Painted properties worth carrying. Values equal to the default are skipped. */
const PAINT_PROPERTIES: Array<[property: string, initial: string]> = [
  ['fill', 'rgb(0, 0, 0)'],
  ['fill-opacity', '1'],
  ['fill-rule', 'nonzero'],
  ['stroke', 'none'],
  ['stroke-width', '1px'],
  ['stroke-opacity', '1'],
  ['stroke-linecap', 'butt'],
  ['stroke-linejoin', 'miter'],
  ['stroke-miterlimit', '4'],
  ['stroke-dasharray', 'none'],
  ['stroke-dashoffset', '0px'],
  ['opacity', '1'],
  ['mix-blend-mode', 'normal'],
];

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

  const target = to as unknown as { style?: CSSStyleDeclaration };
  if (!target.style) return;

  const tag = from.tagName.toLowerCase();
  const wanted =
    tag === 'text' || tag === 'tspan' || tag === 'textPath'.toLowerCase()
      ? [...PAINT_PROPERTIES, ...TEXT_PROPERTIES]
      : PAINT_PROPERTIES;

  for (const [property, initial] of wanted) {
    const value = style.getPropertyValue(property).trim();
    if (!value || value === initial) continue;
    target.style.setProperty(property, value);
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
    const value =
      use.getAttribute(property) ?? useStyleDeclaration?.getPropertyValue(property) ?? '';
    if (value) group.setAttribute(property, value === 'currentColor' ? currentColor : value);
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

/** Nothing that runs, nothing that phones home. */
function scrub(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('script, foreignObject'))) el.remove();
  const all: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of all) {
    for (const attribute of Array.from(el.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) el.removeAttribute(attribute.name);
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
