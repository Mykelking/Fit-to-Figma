import type { DesignTree } from '@fit-to-figma/tree';
import type { Batch, BuildReport, MainToUi, UiToMain } from '../shared/messages.js';
import { emptyReport } from '../shared/messages.js';
import { treesFromHtml } from './render.js';
import { checkTrees } from './validate.js';
import type { TreeProblem } from './validate.js';

type Way = 'tree' | 'html' | 'url';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const el = {
  tabs: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-way]')),
  panels: Array.from(document.querySelectorAll<HTMLElement>('[data-panel]')),
  treeDrop: $<HTMLDivElement>('tree-drop'),
  treeFile: $<HTMLInputElement>('tree-file'),
  treeName: $<HTMLSpanElement>('tree-name'),
  htmlDrop: $<HTMLDivElement>('html-drop'),
  htmlFile: $<HTMLInputElement>('html-file'),
  htmlText: $<HTMLTextAreaElement>('html-text'),
  url: $<HTMLInputElement>('url'),
  urlNote: $<HTMLParagraphElement>('url-note'),
  viewport: $<HTMLSelectElement>('viewport'),
  customW: $<HTMLInputElement>('custom-w'),
  customH: $<HTMLInputElement>('custom-h'),
  custom: $<HTMLDivElement>('custom'),
  selector: $<HTMLInputElement>('selector'),
  bind: $<HTMLInputElement>('bind'),
  update: $<HTMLInputElement>('update'),
  go: $<HTMLButtonElement>('go'),
  status: $<HTMLParagraphElement>('status'),
  bar: $<HTMLDivElement>('bar'),
  barFill: $<HTMLDivElement>('bar-fill'),
  out: $<HTMLDivElement>('out'),
};

let way: Way = 'tree';
/** The dropped files themselves: a batch is read one file at a time, twice. */
let loadedFiles: File[] = [];
let loadedName = '';
let busy = false;
/** Set while one build is in flight, so the next file waits for it. */
let waiting: { done: (report: BuildReport) => void; failed: (text: string) => void } | null = null;
let atFile = 0;
let atName = '';
let ofFiles = 1;

// ------------------------------------------------------------------ the ways

for (const tab of el.tabs) {
  tab.addEventListener('click', () => setWay(tab.dataset.way as Way));
}

function setWay(next: Way): void {
  way = next;
  for (const tab of el.tabs) tab.classList.toggle('on', tab.dataset.way === next);
  for (const panel of el.panels) panel.hidden = panel.dataset.panel !== next;
  clearOut();
}

// 1. Drop a tree, a file holding an array of them, or a folder's worth of files.
dropTarget(el.treeDrop, el.treeFile, async (files) => {
  loadedFiles = [];
  const only = files.length === 1 ? files[0] : undefined;
  loadedName = only ? only.name : '';
  el.treeName.textContent = only ? only.name : count(files.length, 'file');
  // Each file is read, checked and let go again: only the counts are kept, so a
  // drop of fifty files never holds more than one file's trees at a time.
  let trees = 0;
  for (const file of files) {
    // checkTrees parses the text once and reports where each tree goes wrong.
    const checked = checkTrees(await file.text());
    if (!checked.ok) {
      fail(problems(checked.errors.length, only ? 'the tree' : file.name), checked.errors);
      return;
    }
    trees += checked.trees.length;
  }
  loadedFiles = files;
  note(readClean(files.length, trees));
});

function readClean(files: number, trees: number): string {
  if (files > 1) return count(files, 'file') + ' read clean, ' + trees.toLocaleString('en-US') + ' trees.';
  return trees === 1 ? loadedName + ' reads clean.' : count(trees, 'tree') + ' read clean.';
}

function problems(n: number, where: string): string {
  return count(n, 'problem') + ' in ' + where + '.';
}

// 2. Drop or paste HTML.
dropTarget(el.htmlDrop, el.htmlFile, async (files) => {
  const file = files[0];
  if (!file) return;
  el.htmlText.value = await file.text();
  loadedName = file.name;
  note(file.name + ' loaded.');
});

el.htmlText.addEventListener('input', clearOut);

// 3. From URL.
el.url.addEventListener('input', clearOut);

// ------------------------------------------------------------------ options

el.viewport.addEventListener('change', () => {
  el.custom.hidden = el.viewport.value !== 'custom';
});

function viewport(): { w: number; h: number } {
  const value = el.viewport.value;
  if (value === 'custom') {
    return { w: clampSize(el.customW.value, 390), h: clampSize(el.customH.value, 844) };
  }
  const parts = value.split('x');
  return { w: clampSize(parts[0], 390), h: clampSize(parts[1], 844) };
}

function clampSize(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 40) return fallback;
  return Math.min(8000, Math.round(n));
}

// ------------------------------------------------------------------ the run

el.go.addEventListener('click', () => {
  void run();
});

async function run(): Promise<void> {
  if (busy) return;
  busy = true;
  el.go.disabled = true;
  clearOut();
  try {
    if (way === 'tree') await buildFiles();
    else await buildTrees(await gather());
  } catch (err) {
    fail(message(err));
  } finally {
    busy = false;
    el.go.disabled = false;
  }
}

/**
 * One build message per file, the next file read only once the last is done, so
 * at most one file's trees are in memory here or on the main thread.
 */
async function buildFiles(): Promise<void> {
  if (loadedFiles.length === 0) {
    fail('Drop a tree first.');
    return;
  }
  const files = loadedFiles;
  const many = files.length > 1;
  const sum = emptyReport();
  startBar(files.length);

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!file) continue;
    atFile = i;
    atName = file.name;
    setBar(i, files.length);
    note(many ? 'Reading ' + file.name + ' (' + (i + 1) + ' of ' + files.length + ').' : 'Building.');
    const checked = checkTrees(await file.text());
    if (!checked.ok) {
      fail(problems(checked.errors.length, many ? file.name : 'the tree'), checked.errors);
      return;
    }
    const batch: Batch | undefined = many ? { index: i, total: files.length } : undefined;
    const report = await send({ type: 'build', trees: checked.trees, options: chosen(), batch });
    if (many) addLine(file.name + ': ' + added(report));
    merge(sum, report);
  }

  el.bar.hidden = true;
  showReport(sum);
}

async function buildTrees(trees: DesignTree[] | null): Promise<void> {
  if (!trees || trees.length === 0) return;
  startBar(1);
  note('Building.');
  const report = await send({ type: 'build', trees, options: chosen() });
  el.bar.hidden = true;
  showReport(report);
}

function chosen(): { bindVariables: boolean; updateById: boolean } {
  return { bindVariables: el.bind.checked, updateById: el.update.checked };
}

async function gather(): Promise<DesignTree[] | null> {
  if (way === 'html') {
    const html = el.htmlText.value.trim();
    if (html === '') {
      fail('Drop an .html file or paste markup first.');
      return null;
    }
    note('Rendering.');
    const result = await treesFromHtml({
      html,
      ref: loadedName === '' ? 'pasted.html' : loadedName,
      kind: 'file',
      title: titleOf(html, loadedName === '' ? 'Pasted HTML' : loadedName),
      viewport: viewport(),
      selector: el.selector.value,
    });
    for (const w of result.warnings) addLine(w, 'warn');
    return result.trees;
  }

  const href = el.url.value.trim();
  if (href === '') {
    fail('Type a page URL first.');
    return null;
  }
  note('Fetching.');
  let html: string;
  try {
    const response = await fetch(href, { credentials: 'omit' });
    if (!response.ok) {
      fail('That page answered ' + response.status + '. Run the CLI on it instead: npx fit-to-figma ' + href);
      return null;
    }
    html = await response.text();
  } catch {
    fail('This plugin declares no network access, and the page did not allow a cross-origin read. Run the CLI on it instead: npx fit-to-figma ' + href);
    return null;
  }
  note('Rendering.');
  const result = await treesFromHtml({
    html,
    ref: href,
    kind: 'url',
    title: titleOf(html, href),
    viewport: viewport(),
    selector: el.selector.value,
  });
  for (const w of result.warnings) addLine(w, 'warn');
  return result.trees;
}

function titleOf(html: string, fallback: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const found = m && m[1] ? m[1].trim() : '';
  return found === '' ? fallback : found;
}

// ------------------------------------------------------------------ messages

function post(msg: UiToMain): void {
  parent.postMessage({ pluginMessage: msg }, '*');
}

/** Posts one build and settles when the main thread answers for it. */
function send(msg: UiToMain): Promise<BuildReport> {
  return new Promise<BuildReport>((resolve, reject) => {
    waiting = {
      done: (report) => {
        waiting = null;
        resolve(report);
      },
      failed: (text) => {
        waiting = null;
        reject(new Error(text));
      },
    };
    post(msg);
  });
}

window.addEventListener('message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: MainToUi } | undefined)?.pluginMessage;
  if (!msg) return;
  if (msg.type === 'progress') {
    // The bar runs across the whole drop: this file's share, plus the ones done.
    setBar(atFile + (msg.total > 0 ? msg.done / msg.total : 0), ofFiles);
    note((ofFiles > 1 ? atName + ' - ' : '') + msg.done + ' of ' + msg.total + ' nodes');
    return;
  }
  if (msg.type === 'failed') {
    el.bar.hidden = true;
    waiting?.failed(msg.message);
    return;
  }
  if (msg.type === 'done') {
    setBar(atFile + 1, ofFiles);
    waiting?.done(msg.report);
  }
});

// ------------------------------------------------------------------ output

/** One line per file of a batch, while the totals wait for the end. */
function added(r: BuildReport): string {
  const line = count(r.framesCreated, 'frame') + ' added';
  return r.framesUpdated > 0 ? line + ', ' + count(r.framesUpdated, 'frame') + ' updated.' : line + '.';
}

/** A batch's report is its files' reports added up. */
function merge(sum: BuildReport, r: BuildReport): void {
  sum.nodes += r.nodes;
  sum.frames += r.frames;
  sum.texts += r.texts;
  sum.images += r.images;
  sum.vectors += r.vectors;
  sum.framesCreated += r.framesCreated;
  sum.framesUpdated += r.framesUpdated;
  sum.assetsSkipped += r.assetsSkipped;
  sum.tokensBound += r.tokensBound;
  if (r.tokens !== 'none') sum.tokens = r.tokens;
  for (const family of r.fontsMissing) {
    if (sum.fontsMissing.indexOf(family) < 0) sum.fontsMissing.push(family);
  }
  for (const w of r.warnings) sum.warnings.push(w);
}

function showReport(r: BuildReport): void {
  // The extractor's own warnings are already in here; the build adds to them.
  note('Done.');
  addLine(count(r.nodes, 'node') + ' made: ' + r.frames + ' frames, ' + r.texts + ' text, ' + r.images + ' images, ' + r.vectors + ' vectors.');
  if (r.framesUpdated > 0) addLine(count(r.framesUpdated, 'frame') + ' updated in place.');
  if (r.framesCreated > 0) addLine(count(r.framesCreated, 'frame') + ' added.');
  if (r.fontsMissing.length > 0) {
    addLine('Fell back to Inter: ' + r.fontsMissing.join(', ') + '.', 'warn');
  }
  if (r.assetsSkipped > 0) addLine(count(r.assetsSkipped, 'asset') + ' skipped.', 'warn');
  if (r.tokens === 'variables') addLine(count(r.tokensBound, 'colour') + ' bound to variables.');
  if (r.tokens === 'styles') addLine(count(r.tokensBound, 'colour') + ' bound to paint styles.', 'warn');
  for (const w of r.warnings.slice(0, 40)) addLine(w, 'warn');
  if (r.warnings.length > 40) addLine('and ' + (r.warnings.length - 40) + ' more warnings.', 'warn');
}

function fail(text: string, problems: TreeProblem[] = []): void {
  el.bar.hidden = true;
  note(text, true);
  for (const p of problems.slice(0, 50)) {
    addLine((p.path === '' ? '' : p.path + ' - ') + p.message, 'bad');
  }
  if (problems.length > 50) addLine('and ' + (problems.length - 50) + ' more.', 'bad');
}

function note(text: string, bad = false): void {
  el.status.textContent = text;
  el.status.classList.toggle('bad', bad);
}

function addLine(text: string, kind: '' | 'warn' | 'bad' = ''): void {
  const line = document.createElement('p');
  line.textContent = text;
  if (kind !== '') line.className = kind;
  el.out.appendChild(line);
}

function clearOut(): void {
  el.out.innerHTML = '';
  note('');
  el.bar.hidden = true;
}

function startBar(files: number): void {
  atFile = 0;
  atName = '';
  ofFiles = files;
  el.bar.hidden = false;
  setBar(0, files);
}

function setBar(done: number, total: number): void {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  el.barFill.style.width = pct + '%';
}

function count(n: number, word: string): string {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ------------------------------------------------------------------ dropping

function dropTarget(zone: HTMLElement, input: HTMLInputElement, take: (files: File[]) => Promise<void>): void {
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const files = input.files ? Array.from(input.files) : [];
    if (files.length > 0) void take(files);
  });
  for (const name of ['dragenter', 'dragover']) {
    zone.addEventListener(name, (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
  }
  for (const name of ['dragleave', 'drop']) {
    zone.addEventListener(name, () => zone.classList.remove('over'));
  }
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    const dropped = (e as DragEvent).dataTransfer?.files;
    const files = dropped ? Array.from(dropped) : [];
    if (files.length > 0) void take(files);
  });
}

// The plugin never reaches the network on its own.
el.urlNote.textContent =
  'The manifest declares no domains. A URL only works when you add its domain to networkAccess and the page allows a cross-origin read. Otherwise run the CLI.';
setWay('tree');
