import type { DesignTree, Node, Source } from '@fit-to-figma/tree';
import { Assets } from './assets.js';
import { buildElement } from './build.js';
import { Fonts } from './fonts.js';
import type { Box } from './geometry.js';
import { round } from './geometry.js';
import { Ids } from './ids.js';
import { nameOf } from './semantic.js';
import { PseudoScan } from './text.js';
import type { Viewport } from './style.js';
import { clipsOf, read, solidOf } from './style.js';
import { tokensOf } from './tokens.js';
import type { Warning } from './warnings.js';
import { Warnings } from './warnings.js';

export type { Warning, WarningCode } from './warnings.js';
export { formatWarning } from './warnings.js';
export { hashString } from './ids.js';

/**
 * @fit-to-figma/extract
 *
 * Reads a live DOM and writes a design tree. Plain browser TypeScript: no Node
 * APIs, no bundler magic, nothing that only exists in one host. The same build
 * runs inside a page under puppeteer, inside the plugin's own iframe against
 * pasted HTML, and in a test DOM.
 *
 * `extract` is async because inlining an image means fetching it. Everything
 * else about it is synchronous reading of the DOM the browser has already laid
 * out: it never scrolls, never resizes, and never writes to the page.
 */

export interface ExtractOptions {
  /** What the page was laid out at. Defaults to the window's own size. */
  viewport?: Viewport;
  /** Keep what the page hid. Off by default, as the doc says. */
  includeHidden?: boolean;
  /** How deep to walk before stopping and saying so. */
  maxDepth?: number;
  /** How many bytes of inlined images and vectors to allow. */
  assetBudgetBytes?: number;
  /** What to record about where this came from. */
  source?: Partial<Source>;
  /** Called as each new warning is first raised. */
  onWarning?: (warning: Warning) => void;
}

export interface ExtractResult {
  tree: DesignTree;
  /** What could not be carried faithfully. Never fatal. */
  warnings: Warning[];
}

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_ASSET_BUDGET = 24 * 1024 * 1024;

/** The tree on its own, for a caller that does not want the report. */
export async function extract(root: Element, options: ExtractOptions = {}): Promise<DesignTree> {
  return (await extractWithReport(root, options)).tree;
}

export async function extractWithReport(
  root: Element,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const doc = root.ownerDocument;
  const view = doc?.defaultView;
  if (!doc || !view) throw new Error('extract needs an element that is in a document');

  const warnings = new Warnings(options.onWarning);
  const viewport = options.viewport ?? {
    w: view.innerWidth || root.clientWidth || 0,
    h: view.innerHeight || root.clientHeight || 0,
  };

  const rect = root.getBoundingClientRect();
  const origin = { x: rect.left, y: rect.top };
  const rootStyle = view.getComputedStyle(root);
  const rootBox: Box = {
    x: 0,
    y: 0,
    w: clipsOf(rootStyle) ? rect.width : Math.max(rect.width, root.scrollWidth),
    h: clipsOf(rootStyle) ? rect.height : Math.max(rect.height, root.scrollHeight),
  };

  const ids = new Ids();
  const assets = new Assets(options.assetBudgetBytes ?? DEFAULT_ASSET_BUDGET, warnings);
  const fonts = new Fonts();
  // Read once: which elements on this page can have a ::before or an ::after.
  const pseudo = new PseudoScan(doc, warnings);

  const nodes = await buildElement(
    root,
    {
      root,
      origin,
      view,
      ids,
      assets,
      fonts,
      warnings,
      viewport,
      includeHidden: options.includeHidden ?? false,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      pseudo,
    },
    { clip: rootBox, depth: 0, parentLayout: null, parentContent: null, path: '' },
  );

  const rootNode = asRoot(nodes, root, rootBox, ids);
  paintPage(rootNode, root, view);

  const tree: DesignTree = {
    version: 1,
    source: sourceOf(doc, viewport, options.source),
    fonts: fonts.list(),
    assets: assets.all,
    tokens: tokensOf(root, view, warnings),
    root: rootNode,
  };

  return { tree, warnings: warnings.list() };
}

/**
 * One node at the top, always.
 *
 * The walk usually gives exactly one, but a root that is itself invisible
 * hands its children up instead, and they still need a frame to sit in.
 */
function asRoot(nodes: Node[], root: Element, box: Box, ids: Ids): Node {
  const only = nodes.length === 1 ? nodes[0] : undefined;
  if (only && only.type === 'frame') {
    only.x = 0;
    only.y = 0;
    only.w = round(box.w);
    only.h = round(box.h);
    return only;
  }
  const frame: Node = {
    id: ids.take('#root'),
    name: nameOf(root),
    type: 'frame',
    x: 0,
    y: 0,
    w: round(box.w),
    h: round(box.h),
  };
  if (nodes.length > 0) frame.children = nodes;
  return frame;
}

/**
 * The page's own background.
 *
 * A browser takes the background off `<html>`, or off `<body>` when `<html>`
 * has none, and paints the whole canvas with it. Neither element necessarily
 * covers the page, so the colour is put on the root frame where it belongs.
 */
function paintPage(rootNode: Node, root: Element, view: Window): void {
  const first = rootNode.fills?.[0];
  if (first && first.type === 'solid' && first.opacity === 1) return;

  const doc = root.ownerDocument;
  if (!doc) return;
  const candidates = [doc.documentElement, doc.body].filter(Boolean) as Element[];
  for (const el of candidates) {
    const style = view.getComputedStyle(el);
    const solid = solidOf(read(style, 'background-color'), read(style, 'color'));
    if (solid && solid.opacity === 1) {
      rootNode.fills = [solid, ...(rootNode.fills ?? [])];
      return;
    }
  }
}

function sourceOf(doc: Document, viewport: Viewport, given?: Partial<Source>): Source {
  const href = doc.location?.href ?? '';
  const isFile = href.startsWith('file:') || href === '' || href === 'about:blank';
  return {
    kind: given?.kind ?? (isFile ? 'file' : 'url'),
    ref: given?.ref ?? href,
    title: given?.title ?? doc.title ?? '',
    capturedAt: given?.capturedAt ?? new Date().toISOString(),
    viewport: given?.viewport ?? { w: round(viewport.w), h: round(viewport.h) },
  };
}
