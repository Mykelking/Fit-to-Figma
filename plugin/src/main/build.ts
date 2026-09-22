import type { DesignTree, Layout, Node as TreeNode, Place, Sizing, TextStyle } from '@fit-to-figma/tree';
import type { BuildOptions, BuildReport } from '../shared/messages.js';
import { emptyReport } from '../shared/messages.js';
import { AssetStore } from './assets.js';
import { clamp01, hexToRgb } from './colour.js';
import { FontStore } from './fonts.js';
import { applyRadius, toEffects, toPaints, toStrokes } from './paint.js';
import type { StrokeAlignment } from './paint.js';
import { TokenStore } from './tokens.js';

const DEFAULT_BATCH = 200;
const MIN_SIZE = 0.01;

export interface BuildHooks {
  onProgress?: (done: number, total: number, label: string) => void;
}

interface Ctx {
  assets: AssetStore;
  tokens: TokenStore;
  fonts: FontStore;
  report: BuildReport;
  options: BuildOptions;
  hooks: BuildHooks;
  total: number;
  batch: number;
  label: string;
}

function countNodes(node: TreeNode): number {
  let n = 1;
  if (Array.isArray(node.children)) for (const c of node.children) n += countNodes(c);
  return n;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function size(n: number | undefined, fallback = 1): number {
  return typeof n === 'number' && Number.isFinite(n) && n > MIN_SIZE ? n : fallback;
}

function at(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Builds every tree in one run and returns one report for all of them. */
export async function build(
  trees: DesignTree[],
  options: BuildOptions,
  hooks: BuildHooks = {},
): Promise<BuildReport> {
  const report = emptyReport();
  const made: SceneNode[] = [];
  const total = trees.reduce((n, t) => n + (t.root ? countNodes(t.root) : 0), 0);

  const first = trees[0];
  const collectionName = options.collection ?? (first ? sourceName(first) : 'Fit to Figma');
  const tokens = new TokenStore(collectionName, allTokens(trees));
  tokens.init(options.bindVariables === true);
  report.tokens = tokens.target;

  const fonts = new FontStore();
  const ctx: Ctx = {
    assets: new AssetStore({}),
    tokens,
    fonts,
    report,
    options,
    hooks,
    total,
    batch: options.batchSize && options.batchSize > 0 ? options.batchSize : DEFAULT_BATCH,
    label: '',
  };

  // One running offset per section, or per page when a tree named no section.
  const offsets = new Map<string, number>();
  const sections = new Map<string, SectionNode>();
  let named: PageNode | null = null;
  for (const tree of trees) {
    if (!tree || !tree.root) {
      report.warnings.push('a tree with no root was skipped');
      continue;
    }
    ctx.assets = new AssetStore(tree.assets ?? {});
    ctx.label = sourceName(tree);
    let page = figma.currentPage;
    try {
      if (typeof tree.page === 'string' && tree.page !== '') {
        page = pageNamed(tree.page);
        if (!named) named = page;
      }
      const section =
        typeof tree.section === 'string' && tree.section !== ''
          ? sectionNamed(tree.section, page, sections)
          : null;
      const key = section ? section.id : page.id;
      const offset = offsets.get(key) ?? 0;
      const built = await buildRoot(tree, ctx, { page, section }, offset);
      if (built) {
        made.push(built.frame);
        // A placed tree sits where it asked to; it does not move the next one.
        if (!built.placed) offsets.set(key, offset + built.frame.width + 120);
      }
    } catch (err) {
      report.warnings.push(ctx.label + ': ' + message(err));
    }
    report.assetsSkipped += ctx.assets.skipped;
  }

  for (const section of sections.values()) fitSection(section, report);

  for (const w of tokens.warnings) report.warnings.push(w);
  report.tokensBound = tokens.bound;
  report.fontsMissing = Array.from(fonts.missing).sort();

  // The page is switched once, at the end: switching per tree costs a redraw each.
  if (named && named !== figma.currentPage) figma.currentPage = named;

  const here = made.filter(onCurrentPage);
  if (here.length > 0) {
    figma.currentPage.selection = here;
    try {
      figma.viewport.scrollAndZoomIntoView(here);
    } catch {
      // A fake or a headless file may not have a viewport. Not worth a warning.
    }
  }
  return report;
}

/**
 * The page with this name, or a new one. The manifest asks for no dynamic page
 * access, so the pages and their children are all readable here and now.
 */
function pageNamed(name: string): PageNode {
  for (const child of figma.root.children) {
    if (child.name === name) return child;
  }
  const made = figma.createPage();
  made.name = name;
  return made;
}

/** The air a section keeps round the frames in it. */
const SECTION_PAD = 80;

/** The gap under everything on a page before a new section starts. */
const SECTION_GAP = 240;

/**
 * The section of that name on the page, or a new one under everything already
 * there. One build looks each name up once, hence the cache.
 */
function sectionNamed(name: string, page: PageNode, cache: Map<string, SectionNode>): SectionNode {
  const key = page.id + '\n' + name;
  const known = cache.get(key);
  if (known) return known;

  for (const child of page.children) {
    if (child.type === 'SECTION' && child.name === name) {
      cache.set(key, child);
      return child;
    }
  }

  // Read the page before the new section is on it, or it would measure itself.
  const start = under(page);
  const made = figma.createSection();
  made.name = name;
  page.appendChild(made);
  made.x = start.x;
  made.y = start.y;
  cache.set(key, made);
  return made;
}

/** Under the lowest thing on the page, lined up with the leftmost. */
function under(page: PageNode): { x: number; y: number } {
  let left = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of page.children) {
    const box = child as SceneNode & { x: number; y: number; height: number };
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) continue;
    left = Math.min(left, box.x);
    bottom = Math.max(bottom, box.y + (Number.isFinite(box.height) ? box.height : 0));
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0 };
  return { x: left, y: bottom + SECTION_GAP };
}

/**
 * A section is drawn round what is in it. The frames are shifted to sit at the
 * padding and the section moves the other way by as much, so nothing on the
 * page appears to move.
 */
function fitSection(section: SectionNode, report: BuildReport): void {
  const children = section.children;
  if (children.length === 0) return;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const child of children) {
    left = Math.min(left, child.x);
    top = Math.min(top, child.y);
    right = Math.max(right, child.x + child.width);
    bottom = Math.max(bottom, child.y + child.height);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return;

  try {
    const dx = SECTION_PAD - left;
    const dy = SECTION_PAD - top;
    for (const child of children) {
      child.x += dx;
      child.y += dy;
    }
    section.x -= dx;
    section.y -= dy;
    section.resizeWithoutConstraints(right - left + SECTION_PAD * 2, bottom - top + SECTION_PAD * 2);
  } catch (err) {
    report.warnings.push('section ' + section.name + ': ' + message(err));
  }
}

/** A frame on another page can be neither selected nor scrolled into view. */
function onCurrentPage(node: SceneNode): boolean {
  let at: BaseNode | null = node;
  while (at) {
    if (at === figma.currentPage) return true;
    at = at.parent;
  }
  return false;
}

function allTokens(trees: DesignTree[]): DesignTree['tokens'] {
  const seen = new Map<string, DesignTree['tokens'][number]>();
  for (const tree of trees) {
    for (const token of tree.tokens ?? []) {
      if (token && typeof token.name === 'string' && !seen.has(token.name)) seen.set(token.name, token);
    }
  }
  return Array.from(seen.values());
}

function sourceName(tree: DesignTree): string {
  const title = tree.source && typeof tree.source.title === 'string' ? tree.source.title.trim() : '';
  if (title !== '') return title;
  const ref = tree.source && typeof tree.source.ref === 'string' ? tree.source.ref : '';
  return ref !== '' ? ref : 'Fit to Figma';
}

interface Built {
  frame: FrameNode;
  /** Put by tree.place rather than by the running offset. */
  placed: boolean;
}

/** Where a tree's root frame goes: a page, and a section on it when it named one. */
interface Target {
  page: PageNode;
  section: SectionNode | null;
}

async function buildRoot(tree: DesignTree, ctx: Ctx, target: Target, offset: number): Promise<Built | null> {
  const root = tree.root;
  const { page, section } = target;
  const existing = ctx.options.updateById ? findByFitId(root.id, page) : null;
  const place = placeOf(tree);

  const frame = (await makeNode(root, ctx)) as FrameNode | null;
  if (!frame) return null;
  frame.name = sourceName(tree);
  frame.setPluginData('fitId', root.id);
  frame.setPluginData('fitSource', tree.source ? String(tree.source.ref) : '');

  if (existing) {
    const parent = existing.parent ?? page;
    const index = parent.children.indexOf(existing);
    frame.x = existing.x;
    frame.y = existing.y;
    if (index >= 0) parent.insertChild(index, frame);
    else parent.appendChild(frame);
    existing.remove();
    ctx.report.framesUpdated += 1;
  } else if (section) {
    // Inside a section the numbers are the section's own, and the section is
    // drawn round its frames once the run is over.
    frame.x = place ? Math.round(place.x) : offset;
    frame.y = place ? Math.round(place.y) : 0;
    section.appendChild(frame);
    ctx.report.framesCreated += 1;
  } else if (place) {
    frame.x = Math.round(place.x);
    frame.y = Math.round(place.y);
    page.appendChild(frame);
    ctx.report.framesCreated += 1;
  } else {
    const centre = figma.viewport.center ?? { x: 0, y: 0 };
    frame.x = Math.round(centre.x - frame.width / 2) + offset;
    frame.y = Math.round(centre.y - frame.height / 2);
    page.appendChild(frame);
    ctx.report.framesCreated += 1;
  }

  await addChildren(frame, root, ctx);
  return { frame, placed: existing === null && place !== null };
}

/** An existing frame's own position wins, so place is read only without one. */
function placeOf(tree: DesignTree): Place | null {
  const place = tree.place;
  if (!place || !Number.isFinite(place.x) || !Number.isFinite(place.y)) return null;
  return place;
}

/**
 * The frame a previous run left behind on that page, matched on pluginData.fitId,
 * whether it sits on the page itself or in one of its sections.
 */
function findByFitId(id: string, page: PageNode = figma.currentPage): FrameNode | null {
  const top = frameWithId(page.children, id);
  if (top) return top;
  for (const child of page.children) {
    if (child.type !== 'SECTION') continue;
    const inside = frameWithId(child.children, id);
    if (inside) return inside;
  }
  return null;
}

function frameWithId(children: readonly SceneNode[], id: string): FrameNode | null {
  for (const child of children) {
    if (child.type !== 'FRAME') continue;
    try {
      if (child.getPluginData('fitId') === id) return child;
    } catch {
      // A node that will not answer is not our frame.
    }
  }
  return null;
}

async function addChildren(parent: FrameNode, node: TreeNode, ctx: Ctx): Promise<void> {
  const children = Array.isArray(node.children) ? node.children : [];
  const absolute = !node.layout;
  for (const child of children) {
    try {
      const made = await makeNode(child, ctx);
      if (!made) continue;
      parent.appendChild(made);
      if (absolute) {
        made.x = at(child.x) - at(node.x);
        made.y = at(child.y) - at(node.y);
        // Text is placed before it is anchored: its width is its own by now.
        if (made.type === 'TEXT') anchorText(made, child);
      }
      applySizing(made, child.sizing, !absolute, ctx);
      if (made.type === 'FRAME' && child.type === 'frame') {
        await addChildren(made, child, ctx);
      }
    } catch (err) {
      ctx.report.warnings.push(label(child) + ': ' + message(err));
    }
  }
}

/** One node, no children. Returns null when the node is not worth drawing. */
async function makeNode(node: TreeNode, ctx: Ctx): Promise<SceneNode | null> {
  if (!node || typeof node !== 'object') return null;
  let made: SceneNode | null = null;

  switch (node.type) {
    case 'text':
      made = await makeText(node, ctx);
      break;
    case 'image':
      made = makeImage(node, ctx);
      break;
    case 'vector':
      made = makeVector(node, ctx);
      break;
    case 'frame':
      made = makeFrame(node, ctx);
      break;
    default:
      // An unknown type still draws: an empty frame keeps the box and the name.
      made = makeFrame(node, ctx);
      break;
  }
  if (!made) return null;

  made.name = typeof node.name === 'string' && node.name !== '' ? node.name : node.id;
  applyCommon(made, node, ctx);

  ctx.report.nodes += 1;
  if (made.type === 'FRAME' && node.type === 'frame') ctx.report.frames += 1;
  if (node.type === 'text') ctx.report.texts += 1;
  if (node.type === 'image') ctx.report.images += 1;
  if (node.type === 'vector') ctx.report.vectors += 1;

  if (ctx.report.nodes % ctx.batch === 0) {
    ctx.hooks.onProgress?.(ctx.report.nodes, ctx.total, ctx.label);
    await yieldToLoop();
  }
  return made;
}

function makeFrame(node: TreeNode, ctx: Ctx): FrameNode {
  const frame = figma.createFrame();
  frame.resize(size(node.w), size(node.h));
  frame.fills = [];
  frame.clipsContent = node.clip === true;
  if (node.layout) applyLayout(frame, node.layout, ctx);
  return frame;
}

function applyLayout(frame: FrameNode, layout: Layout, ctx: Ctx): void {
  try {
    frame.layoutMode = layout.mode === 'row' ? 'HORIZONTAL' : 'VERTICAL';
    if (Number.isFinite(layout.gap)) frame.itemSpacing = Math.max(0, layout.gap);
    const pad = Array.isArray(layout.padding) ? layout.padding : [0, 0, 0, 0];
    frame.paddingTop = Math.max(0, at(pad[0]));
    frame.paddingRight = Math.max(0, at(pad[1]));
    frame.paddingBottom = Math.max(0, at(pad[2]));
    frame.paddingLeft = Math.max(0, at(pad[3]));
    frame.primaryAxisAlignItems = mainAxis(layout.justify);
    frame.counterAxisAlignItems = crossAxis(layout.align);
    frame.layoutWrap = layout.wrap === true ? 'WRAP' : 'NO_WRAP';
  } catch (err) {
    ctx.report.warnings.push('auto layout: ' + message(err));
  }
}

function mainAxis(justify: Layout['justify']): 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN' {
  switch (justify) {
    case 'center':
      return 'CENTER';
    case 'end':
      return 'MAX';
    case 'space-between':
      return 'SPACE_BETWEEN';
    default:
      return 'MIN';
  }
}

function crossAxis(align: Layout['align']): 'MIN' | 'CENTER' | 'MAX' | 'BASELINE' {
  switch (align) {
    case 'center':
      return 'CENTER';
    case 'end':
      return 'MAX';
    default:
      // Figma has no stretch on the counter axis: the child's sizing carries it.
      return 'MIN';
  }
}

function makeImage(node: TreeNode, ctx: Ctx): SceneNode | null {
  const rect = figma.createRectangle();
  rect.resize(size(node.w), size(node.h));
  const id = typeof node.asset === 'string' ? node.asset : '';
  const hash = id === '' ? null : ctx.assets.imageHash(id);
  if (hash === null) {
    rect.fills = [];
    ctx.report.warnings.push(label(node) + ': image asset ' + id + ' was skipped');
    return rect;
  }
  rect.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FILL' }];
  return rect;
}

function makeVector(node: TreeNode, ctx: Ctx): SceneNode | null {
  const id = typeof node.asset === 'string' ? node.asset : '';
  const svg = id === '' ? null : ctx.assets.svg(id);
  if (svg === null) {
    ctx.report.warnings.push(label(node) + ': vector asset ' + id + ' was skipped');
    return null;
  }
  const made = figma.createNodeFromSvg(svg);
  try {
    made.resize(size(node.w), size(node.h));
  } catch (err) {
    ctx.report.warnings.push(label(node) + ': ' + message(err));
  }
  return made;
}

async function makeText(node: TreeNode, ctx: Ctx): Promise<SceneNode | null> {
  const style: TextStyle | undefined = node.text;
  if (!style || typeof style.content !== 'string') {
    ctx.report.warnings.push(label(node) + ': a text node with no text was skipped');
    return null;
  }
  const font = style.font ?? { family: 'Inter', weight: 400, style: 'normal', size: 16, lineHeight: 0, letterSpacing: 0 };
  const resolved = await ctx.fonts.resolve(
    typeof font.family === 'string' && font.family !== '' ? font.family : 'Inter',
    Number.isFinite(font.weight) ? font.weight : 400,
    font.style === 'italic',
  );

  const text = figma.createText();
  text.fontName = resolved.font;
  text.characters = transform(style.content, style.transform);

  if (Number.isFinite(font.size) && font.size > 0) text.fontSize = font.size;
  if (Number.isFinite(font.lineHeight) && font.lineHeight > 0) {
    text.lineHeight = { unit: 'PIXELS', value: font.lineHeight };
  }
  if (Number.isFinite(font.letterSpacing) && font.letterSpacing !== 0) {
    text.letterSpacing = { unit: 'PIXELS', value: font.letterSpacing };
  }
  text.textAlignHorizontal = style.align === 'center' ? 'CENTER' : style.align === 'right' ? 'RIGHT' : 'LEFT';
  text.textDecoration =
    style.decoration === 'underline' ? 'UNDERLINE' : style.decoration === 'strike' ? 'STRIKETHROUGH' : 'NONE';

  if (typeof style.color === 'string') {
    const solid: SolidPaint = {
      type: 'SOLID',
      color: hexToRgb(style.color),
      opacity: clamp01(style.opacity === undefined ? 1 : style.opacity),
    };
    const bound = ctx.tokens.bind(solid, style.color);
    text.fills = [bound.paint];
    if (bound.styleId !== undefined) text.fillStyleId = bound.styleId;
  }

  fitText(text, node, style);
  return text;
}

/**
 * Figma's metrics are not the browser's, so a line that only just fitted on the
 * page wraps here and overlaps whatever is under it. A run the browser drew on
 * one line sizes itself and never wraps; a run that wrapped keeps its measured
 * width, with a pixel of slack each side, and grows downwards.
 */
function fitText(text: TextNode, node: TreeNode, style: TextStyle): void {
  if (oneLine(node, style)) {
    text.textAutoResize = 'WIDTH_AND_HEIGHT';
    return;
  }
  text.textAutoResize = 'HEIGHT';
  text.resize(size(node.w) + 2, size(node.h));
}

/** What the extractor measured, or the box read against the line height. */
function oneLine(node: TreeNode, style: TextStyle): boolean {
  const lines = style.lines;
  if (typeof lines === 'number' && Number.isFinite(lines) && lines >= 1) return lines === 1;
  const font = style.font;
  const line = font && Number.isFinite(font.lineHeight) && font.lineHeight > 0 ? font.lineHeight : 0;
  return line > 0 && size(node.h) <= line * 1.5;
}

/** A text layer that sized itself keeps the edge its alignment is measured from. */
function anchorText(text: TextNode, node: TreeNode): void {
  const align = node.text ? node.text.align : undefined;
  if (align !== 'center' && align !== 'right') return;
  const slack = size(node.w) - text.width;
  text.x += align === 'center' ? Math.round(slack / 2) : Math.round(slack);
}

function transform(content: string, how: TextStyle['transform']): string {
  if (how === 'upper') return content.toUpperCase();
  if (how === 'lower') return content.toLowerCase();
  return content;
}

function applyCommon(made: SceneNode, node: TreeNode, ctx: Ctx): void {
  const warn = (text: string): void => {
    ctx.report.warnings.push(label(node) + ': ' + text);
  };

  if (node.type !== 'text' && node.type !== 'image' && 'fills' in made) {
    try {
      const result = toPaints(node.fills, { assets: ctx.assets, tokens: ctx.tokens, warn });
      if (result.paints.length > 0) {
        (made as GeometryMixin).fills = result.paints;
        if (result.styleId !== undefined) (made as GeometryMixin).fillStyleId = result.styleId;
      }
    } catch (err) {
      warn('fills: ' + message(err));
    }
  }

  const stroke = toStrokes(node.strokes);
  if (stroke && 'strokes' in made) {
    try {
      const target = made as GeometryMixin & { strokeWeight: number; strokeAlign: StrokeAlignment };
      target.strokes = stroke.paints;
      target.strokeWeight = stroke.weight;
      target.strokeAlign = stroke.align;
    } catch (err) {
      warn('strokes: ' + message(err));
    }
  }

  if ('topLeftRadius' in made) {
    try {
      applyRadius(made as SceneNode & { topLeftRadius: number }, node.radius);
    } catch (err) {
      warn('radius: ' + message(err));
    }
  }

  const effects = toEffects(node.effects);
  if (effects.length > 0 && 'effects' in made) {
    try {
      (made as BlendMixin).effects = effects;
    } catch (err) {
      warn('effects: ' + message(err));
    }
  }

  if (typeof node.opacity === 'number' && node.opacity < 1 && 'opacity' in made) {
    try {
      (made as BlendMixin).opacity = clamp01(node.opacity);
    } catch (err) {
      warn('opacity: ' + message(err));
    }
  }
}

function applySizing(made: SceneNode, sizing: Sizing | undefined, parentHasLayout: boolean, ctx: Ctx): void {
  if (!sizing || !parentHasLayout) return;
  const target = made as SceneNode & {
    layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
    layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  };
  const set = (axis: 'layoutSizingHorizontal' | 'layoutSizingVertical', mode: string | undefined): void => {
    if (mode !== 'fill' && mode !== 'hug' && mode !== 'fixed') return;
    try {
      target[axis] = mode === 'fill' ? 'FILL' : mode === 'hug' ? 'HUG' : 'FIXED';
    } catch (err) {
      ctx.report.warnings.push(made.name + ': sizing ' + mode + ' - ' + message(err));
    }
  };
  set('layoutSizingHorizontal', sizing.w);
  set('layoutSizingVertical', sizing.h);
}

function label(node: TreeNode): string {
  const name = node && typeof node.name === 'string' && node.name !== '' ? node.name : '(unnamed)';
  const id = node && typeof node.id === 'string' ? node.id : '?';
  return name + ' [' + id + ']';
}
