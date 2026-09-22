import type { ExtractOptions, Warning } from '@fit-to-figma/extract';
import type { DesignTree } from '@fit-to-figma/tree';
import { flatten, validateTree } from '@fit-to-figma/tree';
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from 'puppeteer-core';
import { extractBundle } from './bundle.js';
import { findChrome } from './chrome.js';

/**
 * Open a page in a real browser, run the extractor inside it, and hand back
 * the tree it wrote.
 *
 * The browser is the one already on the machine. Nothing here touches the tree
 * itself: what the page produced is what is written, and it is checked against
 * the schema before it is.
 */

export interface CaptureOptions {
  /** A URL, or a path to an HTML file. */
  target: string;
  viewport?: { w: number; h: number };
  /** Milliseconds to wait, or a selector to wait for. */
  wait?: string;
  /** Grow the viewport to the whole document before extracting. */
  fullPage?: boolean;
  chrome?: string;
  /** Extract from this element instead of the whole document. */
  rootSelector?: string;
  includeHidden?: boolean;
  maxDepth?: number;
  assetBudgetBytes?: number;
  /** How long to give the page to load, in milliseconds. */
  timeout?: number;
}

export interface CaptureResult {
  tree: DesignTree;
  warnings: Warning[];
  nodes: number;
  assetBytes: number;
  fonts: string[];
}

const DEFAULT_VIEWPORT = { w: 390, h: 844 };

export async function capture(options: CaptureOptions): Promise<CaptureResult> {
  const viewport = options.viewport ?? DEFAULT_VIEWPORT;
  const { url, kind } = await targetUrl(options.target);
  const bundle = await extractBundle();
  const timeout = options.timeout ?? 60_000;

  const browser = await launch({
    executablePath: findChrome(options.chrome),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      // A file:// page has to be allowed to read its own sibling images,
      // otherwise every local asset comes back as a placeholder.
      '--allow-file-access-from-files',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: viewport.w, height: viewport.h, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    await waitFor(page, options.wait, timeout);
    await page.evaluate(() => document.fonts?.ready).catch(() => undefined);

    if (options.fullPage) {
      const height = await page.evaluate(
        () => document.documentElement.scrollHeight || document.body.scrollHeight,
      );
      if (height > viewport.h) {
        await page.setViewport({ width: viewport.w, height, deviceScaleFactor: 1 });
        // One frame for the new height to settle before anything is measured.
        await page.evaluate(
          () => new Promise<void>((done) => requestAnimationFrame(() => done())),
        );
      }
    }

    await page.addScriptTag({ content: bundle });

    const extractOptions: ExtractOptions & { rootSelector?: string } = {
      viewport,
      source: { kind, ref: options.target },
      ...(options.rootSelector ? { rootSelector: options.rootSelector } : {}),
      ...(options.includeHidden ? { includeHidden: true } : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
      ...(options.assetBudgetBytes !== undefined
        ? { assetBudgetBytes: options.assetBudgetBytes }
        : {}),
    };

    const raw = (await page.evaluate(async (given) => {
      const api = (globalThis as unknown as { __fitToFigma?: {
        extract(options: unknown): Promise<unknown>;
      } }).__fitToFigma;
      if (!api) throw new Error('the extractor did not load in the page');
      return JSON.parse(JSON.stringify(await api.extract(given))) as unknown;
    }, extractOptions as unknown as Record<string, unknown>)) as {
      tree: unknown;
      warnings: Warning[];
    };

    const checked = validateTree(raw.tree);
    if (!checked.ok) {
      const lines = checked.errors.slice(0, 10).map((issue) => `  ${issue.path}: ${issue.message}`);
      throw new Error(
        `the extractor produced a tree that does not match the schema:\n${lines.join('\n')}`,
      );
    }

    const tree = checked.tree;
    return {
      tree,
      warnings: raw.warnings ?? [],
      nodes: flatten(tree).length,
      assetBytes: assetBytesOf(tree),
      fonts: tree.fonts.map((font) => font.family),
    };
  } finally {
    await browser.close();
  }
}

async function waitFor(
  page: { waitForSelector(selector: string, options: { timeout: number }): Promise<unknown> },
  wait: string | undefined,
  timeout: number,
): Promise<void> {
  if (!wait) return;
  const ms = Number(wait);
  if (Number.isFinite(ms) && String(ms) === wait.trim()) {
    await new Promise((done) => setTimeout(done, ms));
    return;
  }
  await page.waitForSelector(wait, { timeout });
}

export function assetBytesOf(tree: DesignTree): number {
  let total = 0;
  for (const asset of Object.values(tree.assets)) {
    total += asset.type === 'svg' ? asset.data.length : Math.floor((asset.data.length * 3) / 4);
  }
  return total;
}

/** A URL stays a URL; anything else is a path to a file on this machine. */
async function targetUrl(target: string): Promise<{ url: string; kind: 'url' | 'file' }> {
  if (/^https?:\/\//i.test(target)) return { url: target, kind: 'url' };
  if (/^file:\/\//i.test(target)) return { url: target, kind: 'file' };

  const path = isAbsolute(target) ? target : resolve(process.cwd(), target);
  try {
    await stat(path);
  } catch {
    throw new Error(`no such file: ${target}`);
  }
  return { url: pathToFileURL(path).href, kind: 'file' };
}
