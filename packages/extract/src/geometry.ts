/**
 * Boxes.
 *
 * Everything here is in CSS pixels in the root frame's coordinates: the origin
 * is the root element's border box, not the viewport and not the document.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Two decimals is under a tenth of a pixel and keeps the JSON small. */
export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function roundBox(box: Box): Box {
  return { x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) };
}

export function boxFromRect(rect: DOMRect, origin: { x: number; y: number }): Box {
  return { x: rect.left - origin.x, y: rect.top - origin.y, w: rect.width, h: rect.height };
}

export function isEmpty(box: Box): boolean {
  return box.w <= 0 || box.h <= 0;
}

/** The overlap, or an empty box when they do not touch. */
export function intersect(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

export function union(a: Box, b: Box): Box {
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}

/** Does `box` overlap `within` at all? A touching edge does not count. */
export function overlaps(box: Box, within: Box): boolean {
  return !isEmpty(intersect(box, within));
}
