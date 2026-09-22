/**
 * A test DOM with a layout.
 *
 * happy-dom computes style but does not lay anything out: every rectangle
 * comes back as zero, and the extractor would drop the whole page. So the
 * fixtures say where their boxes are with `data-rect="x,y,w,h"` and this
 * stands in for the browser's layout. The real browser test covers what a
 * browser actually does with the same rules.
 */

const DEFAULT: [number, number, number, number] = [0, 0, 100, 20];

let installed = false;

export function installLayout(): void {
  if (installed) return;
  installed = true;

  Element.prototype.getBoundingClientRect = function boundingRect(this: Element): DOMRect {
    const raw = this.getAttribute?.('data-rect');
    const [x, y, w, h] = raw
      ? (raw.split(',').map((part) => Number(part.trim())) as [number, number, number, number])
      : DEFAULT;
    return rect(x ?? 0, y ?? 0, w ?? 0, h ?? 0);
  };
}

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON() {
      return { x, y, width: w, height: h };
    },
  } as DOMRect;
}

export interface Page {
  css?: string;
  body: string;
  /** The body's own box. Everything is clipped to it. */
  rect?: string;
}

/** Put a page in the document and hand back the element to extract from. */
export function mount(page: Page): Element {
  installLayout();
  document.head.innerHTML = page.css ? `<style>${page.css}</style>` : '';
  document.body.innerHTML = page.body;
  document.body.setAttribute('data-rect', page.rect ?? '0,0,390,844');
  return document.body;
}
