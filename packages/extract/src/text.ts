import type { LineBox } from '@fit-to-figma/tree';
import type { Box } from './geometry.js';
import { boxFromRect, isEmpty, round, union } from './geometry.js';
import { read } from './style.js';
import type { Warnings } from './warnings.js';

/**
 * Text.
 *
 * One node per element that holds text. An element whose text is interrupted
 * by an inline child - `<p>plain <b>bold</b> plain</p>` - holds two runs of its
 * own, and the `<b>` is walked normally and becomes a third node beside them.
 * That is what the doc means by splitting a mixed run into siblings: each
 * sibling carries the font the browser actually drew that run with.
 *
 * Boxes come from a `Range` over the text, so a run that wraps onto three
 * lines gets the box of all three, not the box of its element.
 */

export interface TextRun {
  /** The text as the DOM holds it. `text-transform` travels separately. */
  content: string;
  box: Box;
  /** Line boxes the browser drew the run on; 0 when nothing could measure it. */
  lines: number;
  /** The words on each of those lines, when there is more than one. */
  lineBoxes: LineBox[];
  /** A stable suffix for the run's id: which child node it started at. */
  key: string;
}

export interface RunArgs {
  el: Element;
  origin: { x: number; y: number };
  view: Window;
  warnings: Warnings;
  nodeId: string;
}

/** Does this element hold text of its own, ignoring its element children? */
export function hasDirectText(el: Element): boolean {
  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes[i];
    if (node && node.nodeType === 3 && (node.nodeValue ?? '').trim().length > 0) return true;
  }
  return false;
}

/**
 * The element's own text, in document order, split wherever an element child
 * interrupts it.
 */
export function directRuns({ el, origin, view, warnings, nodeId }: RunArgs): TextRun[] {
  const style = view.getComputedStyle(el);
  const whiteSpace = read(style, 'white-space');
  const runs: TextRun[] = [];

  let group: Text[] = [];
  let groupStart = 0;

  const flush = () => {
    if (group.length === 0) return;
    const content = collapse(group.map((node) => node.nodeValue ?? '').join(''), whiteSpace);
    if (content.trim().length > 0) {
      const drawn = boxOfNodes(group, origin, view, warnings, nodeId, el);
      if (drawn) {
        runs.push({
          content,
          box: drawn.box,
          lines: drawn.lines,
          lineBoxes: drawn.lineBoxes,
          key: `#t${groupStart}`,
        });
      }
    }
    group = [];
  };

  for (let i = 0; i < el.childNodes.length; i += 1) {
    const node = el.childNodes[i];
    if (!node) continue;
    if (node.nodeType === 3) {
      if (group.length === 0) groupStart = i;
      group.push(node as Text);
      continue;
    }
    if (node.nodeType === 1) flush();
  }
  flush();

  return runs;
}

/**
 * The box of some text, measured from the text itself.
 *
 * A DOM without layout - a test DOM - gives no client rects at all. There the
 * element's own box is the honest answer, and the run says so once.
 */
function boxOfNodes(
  nodes: Text[],
  origin: { x: number; y: number },
  view: Window,
  warnings: Warnings,
  nodeId: string,
  el: Element,
): { box: Box; lines: number; lineBoxes: LineBox[] } | null {
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (!first || !last) return null;

  const measured = measureRange(first, last, origin, view);
  if (measured && !isEmpty(measured.box)) {
    // A run that begins part way along a line and then wraps has a bounding
    // box that covers both lines, and a text layer placed in that box starts
    // at its left edge instead of where the run really began. The box is the
    // truth about where the run is; it is not where the plugin can start
    // drawing it, so say so.
    if (measured.lines > 1 && measured.startsMidLine) {
      warnings.add(
        'text-run-wrapped',
        'a run of text starts part way along a line and wraps, so its box is the box of the whole run and not where the first word sits',
        { node: nodeId },
      );
    }
    // Only a run that wrapped needs its lines carried: one line cannot break.
    const lineBoxes = measured.lines > 1 ? lineBoxesOf(nodes, origin, view) : [];
    return { box: measured.box, lines: measured.lines, lineBoxes };
  }

  warnings.add(
    'text-measure-unavailable',
    'the browser gave no rectangles for a run of text, its element box was used instead',
    { node: nodeId },
  );
  const rect = el.getBoundingClientRect();
  const box = boxFromRect(rect, origin);
  // Nothing measured it, so nothing is claimed about how many lines it took.
  return isEmpty(box) ? null : { box, lines: 0, lineBoxes: [] };
}

/**
 * Which words the browser put on which line.
 *
 * Figma breaks lines at its own words, so a paragraph rebuilt from the run's
 * text alone comes out a line longer and covers whatever is under it. Every
 * word is measured on its own and the ones that share a line are grouped, so
 * the plugin can draw the lines the page drew.
 */
function lineBoxesOf(nodes: Text[], origin: { x: number; y: number }, view: Window): LineBox[] {
  const doc = view.document;
  if (typeof doc?.createRange !== 'function') return [];
  const lines: LineBox[] = [];
  let box: Box | null = null;
  let words: string[] = [];

  const flush = (): void => {
    if (!box || words.length === 0) return;
    lines.push({ text: words.join(' '), x: round(box.x), y: round(box.y), w: round(box.w), h: round(box.h) });
    box = null;
    words = [];
  };

  for (const node of nodes) {
    const text = node.nodeValue ?? '';
    const word = /\S+/g;
    let found = word.exec(text);
    while (found) {
      const rect = wordRect(doc, node, found.index, found.index + found[0].length);
      if (rect) {
        const at = boxFromRect(rect, origin);
        if (!isEmpty(at)) {
          // A word whose top matches the line being built is on that line.
          if (box && Math.abs(at.y - box.y) <= 1) {
            box = union(box, at);
            words.push(found[0]);
          } else {
            flush();
            box = at;
            words = [found[0]];
          }
        }
      }
      found = word.exec(text);
    }
  }
  flush();
  return lines;
}

function wordRect(doc: Document, node: Text, start: number, end: number): DOMRect | null {
  try {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const rect = range.getBoundingClientRect?.();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  } catch {
    return null;
  }
}

interface Measured {
  box: Box;
  /** How many line boxes the run covers. */
  lines: number;
  /** Does the run begin to the right of where its own box starts? */
  startsMidLine: boolean;
}

function measureRange(
  first: Text,
  last: Text,
  origin: { x: number; y: number },
  view: Window,
): Measured | null {
  const doc = view.document;
  if (typeof doc?.createRange !== 'function') return null;
  try {
    const range = doc.createRange();
    range.setStart(first, 0);
    range.setEnd(last, (last.nodeValue ?? '').length);
    const rects = range.getClientRects?.();
    if (!rects || rects.length === 0) return null;

    let box: Box = { x: 0, y: 0, w: 0, h: 0 };
    let lines = 0;
    let firstLeft = Number.POSITIVE_INFINITY;
    for (let i = 0; i < rects.length; i += 1) {
      const rect = rects[i];
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (lines === 0) firstLeft = rect.left - origin.x;
      lines += 1;
      box = union(box, boxFromRect(rect, origin));
    }
    if (isEmpty(box)) return null;
    return { box, lines, startsMidLine: firstLeft > box.x + 0.5 };
  } catch {
    return null;
  }
}

/** What the browser does to whitespace before it draws it. */
export function collapse(text: string, whiteSpace: string): string {
  const mode = (whiteSpace || 'normal').toLowerCase();
  if (mode === 'pre' || mode === 'pre-wrap' || mode === 'break-spaces') return text;
  if (mode === 'pre-line') return text.replace(/[ \t]+/g, ' ');
  return text.replace(/\s+/g, ' ');
}

// -------------------------------------------------------------- pseudo text

export interface PseudoText {
  content: string;
  which: '::before' | '::after';
  style: CSSStyleDeclaration;
}

/**
 * Which elements can have a `::before` or an `::after` at all.
 *
 * Asking `getComputedStyle(el, '::before')` is not free, and asking it twice
 * for every element on a page of 1,500 is most of a second. Only a stylesheet
 * can make a pseudo element, so the stylesheets are read once and the elements
 * that match one of those selectors are the only ones asked. A stylesheet that
 * cannot be read - cross-origin - means falling back to asking everything,
 * which is the old cost and never the wrong answer.
 */
export class PseudoScan {
  /** The subjects of every `::before` / `::after` rule, as one selector. */
  private readonly selector: string | null;
  private readonly askEverything: boolean;

  constructor(doc: Document, warnings: Warnings) {
    const subjects = new Set<string>();
    let unreadable = false;

    const sheets = doc.styleSheets;
    for (let i = 0; i < (sheets?.length ?? 0); i += 1) {
      const sheet = sheets[i];
      if (!sheet) continue;
      try {
        collectPseudoSubjects(sheet.cssRules, subjects);
      } catch {
        unreadable = true;
      }
    }

    if (unreadable) {
      warnings.add(
        'stylesheet-unreadable',
        'a stylesheet is cross-origin, so every element was checked for ::before and ::after instead of only the ones that can have them',
      );
    }

    this.askEverything = unreadable;
    this.selector = subjects.size > 0 ? Array.from(subjects).join(',') : null;
  }

  canHavePseudo(el: Element): boolean {
    if (this.askEverything) return true;
    if (!this.selector) return false;
    try {
      return el.matches(this.selector);
    } catch {
      return true;
    }
  }
}

/** The part of `a.b::before` that an element could match: `a.b`. */
function collectPseudoSubjects(rules: CSSRuleList, subjects: Set<string>): void {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule) continue;

    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested && nested.length > 0) collectPseudoSubjects(nested, subjects);

    const selector = (rule as CSSStyleRule).selectorText;
    if (typeof selector !== 'string' || !/::?(?:before|after)\b/i.test(selector)) continue;

    for (const part of selector.split(',')) {
      const subject = part.replace(/::?(?:before|after)\b.*$/i, '').trim();
      // A bare `::before` has no subject of its own, so nothing can be skipped.
      subjects.add(subject === '' ? '*' : subject);
    }
  }
}

/**
 * `::before` and `::after` when their content is text.
 *
 * A pseudo element has no node and no rectangle, so its box is worked out from
 * the element's content box and the font, and the run says once that the
 * position is an approximation. Content that is a `url()` or a counter is not
 * text and is skipped.
 */
export function pseudoTexts(
  el: Element,
  view: Window,
  warnings: Warnings,
  nodeId: string,
): PseudoText[] {
  const out: PseudoText[] = [];
  for (const which of ['::before', '::after'] as const) {
    let style: CSSStyleDeclaration;
    try {
      style = view.getComputedStyle(el, which);
    } catch {
      continue;
    }
    if (!style) continue;
    if (read(style, 'display') === 'none') continue;
    if (read(style, 'visibility') === 'hidden') continue;

    const raw = read(style, 'content');
    if (!raw || raw === 'none' || raw === 'normal') continue;

    if (/\burl\(/i.test(raw)) {
      warnings.add(
        'pseudo-image-skipped',
        'a ::before or ::after drew an image, which is not carried into the tree',
        { detail: `${el.tagName.toLowerCase()}${which}`, node: nodeId },
      );
      continue;
    }

    const content = unquote(raw);
    if (content.trim().length === 0) continue;
    out.push({ content, which, style });
  }
  return out;
}

/** `"\f101"` and `"Read more"` both come back as the text they stand for. */
function unquote(content: string): string {
  const parts = content.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g);
  if (!parts) return '';
  return parts
    .map((part) => part.slice(1, -1).replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    ))
    .join('');
}

/**
 * A rough box for a pseudo element.
 *
 * Nothing measures it properly: the browser exposes no rectangle. When the
 * element has no text of its own the pseudo fills its content box, which is
 * the common icon case and is right. Otherwise the text is measured on a
 * canvas where there is one, and estimated from the font size where there is
 * not.
 */
export function pseudoBox(
  el: Element,
  pseudo: PseudoText,
  elementBox: Box,
  view: Window,
  warnings: Warnings,
  nodeId: string,
): Box {
  const size = Number.parseFloat(read(pseudo.style, 'font-size')) || 16;
  const lineHeight = Number.parseFloat(read(pseudo.style, 'line-height')) || size * 1.2;

  if (!hasDirectText(el) && el.children.length === 0) {
    return elementBox;
  }

  warnings.add(
    'pseudo-position-approximated',
    'a ::before or ::after has no rectangle of its own, its position is an estimate',
    { detail: `${el.tagName.toLowerCase()}${pseudo.which}`, node: nodeId },
  );

  const width = measureText(pseudo.content, pseudo.style, view) ?? pseudo.content.length * size * 0.55;
  const x = pseudo.which === '::before' ? elementBox.x : elementBox.x + elementBox.w - width;
  const y = elementBox.y + Math.max(0, (elementBox.h - lineHeight) / 2);
  return { x, y, w: width, h: lineHeight };
}

function measureText(text: string, style: CSSStyleDeclaration, view: Window): number | null {
  try {
    const canvas = view.document.createElement('canvas');
    const context = canvas.getContext?.('2d');
    if (!context) return null;
    const family = read(style, 'font-family') || 'sans-serif';
    const size = read(style, 'font-size') || '16px';
    const weight = read(style, 'font-weight') || '400';
    context.font = `${weight} ${size} ${family}`;
    const width = context.measureText(text).width;
    return Number.isFinite(width) && width > 0 ? width : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ form controls

/** What a form control draws, which is never a child node. */
export function controlText(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'file' || type === 'hidden') {
      return null;
    }
    if (type === 'password') return input.value ? '•'.repeat(input.value.length) : null;
    return input.value || input.getAttribute('placeholder') || null;
  }
  if (tag === 'textarea') {
    const area = el as HTMLTextAreaElement;
    return area.value || area.getAttribute('placeholder') || null;
  }
  if (tag === 'select') {
    const select = el as HTMLSelectElement;
    const option = select.selectedOptions?.[0] ?? select.options?.[0];
    return option?.textContent?.trim() || null;
  }
  return null;
}

// ---------------------------------------------------------------- icon fonts

const ICON_FAMILY = /\b(icon|glyph|fontawesome|font awesome|material icons|material symbols|ionicons|feather|remixicon|iconsax|phosphor|bootstrap-icons)\b/i;

/** A private use codepoint, which is how an icon font addresses its glyphs. */
export function looksLikeIcon(content: string, family: string): boolean {
  if (ICON_FAMILY.test(family)) return true;
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xe000 && code <= 0xf8ff) return true;
    if (code >= 0xf0000 && code <= 0xffffd) return true;
  }
  return false;
}
