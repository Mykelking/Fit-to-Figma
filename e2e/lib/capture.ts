import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, findCliBin, findExtractEntry } from './parts.js';

export interface Capture {
  /** The parsed tree, unvalidated. */
  tree: unknown;
  /** Wall clock for the whole run, in ms. */
  ms: number;
  /** Time inside extract() alone, when the direct path was used. */
  extractMs: number | null;
  /** 'cli' when it came through `fit-to-figma capture`, 'direct' otherwise. */
  via: 'cli' | 'direct';
  warnings: string[];
  stdout: string;
  stderr: string;
}

export function tempDir(tag: string): string {
  return mkdtempSync(path.join(tmpdir(), `ftf-${tag}-`));
}

// ------------------------------------------------------------------ the CLI

function run(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += String(d)));
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/** `fit-to-figma capture <file> -o out.json`, run against a real Chrome. */
export async function captureViaCli(
  htmlPath: string,
  outPath: string,
  chrome: string,
  viewport?: { w: number; h: number },
  timeoutMs = 120_000,
): Promise<Capture> {
  const bin = findCliBin();
  if (!bin) throw new Error('no CLI on disk');

  // The CLI lays out at 390x844 unless told otherwise; each fixture has its own width.
  const args = [bin, 'capture', htmlPath, '-o', outPath];
  if (viewport) args.push('--viewport', `${viewport.w}x${viewport.h}`);

  const started = performance.now();
  const r = await run(
    process.execPath,
    args,
    { CHROME: chrome, PUPPETEER_EXECUTABLE_PATH: chrome, NO_COLOR: '1' },
    timeoutMs,
  );
  const ms = performance.now() - started;

  if (r.code !== 0) {
    throw new Error(`fit-to-figma capture exited ${r.code}\n--- stderr ---\n${r.stderr}\n--- stdout ---\n${r.stdout}`);
  }

  let tree: unknown;
  try {
    tree = JSON.parse(readFileSync(outPath, 'utf8'));
  } catch (e) {
    throw new Error(`no readable tree at ${outPath}: ${(e as Error).message}\n--- stderr ---\n${r.stderr}`);
  }

  return { tree, ms, extractMs: null, via: 'cli', warnings: [], stdout: r.stdout, stderr: r.stderr };
}

// ------------------------------------------------ the extractor, in the page

/**
 * Until the CLI lands, drive `extract(root, options)` in a real page directly:
 * bundle the extractor for the browser, inject it, call it. Same code path the
 * CLI will use, minus the CLI.
 */

let bundlePromise: Promise<string> | null = null;

async function extractorBundle(): Promise<string> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    const entry = findExtractEntry();
    if (!entry) throw new Error('no extractor on disk');
    const esbuild = await import('esbuild');
    const out = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: 'iife',
      globalName: 'FTF',
      platform: 'browser',
      target: 'chrome120',
      write: false,
      absWorkingDir: ROOT,
      logLevel: 'silent',
    });
    const file = out.outputFiles?.[0];
    if (!file) throw new Error('esbuild produced no bundle for the extractor');
    return file.text;
  })();
  return bundlePromise;
}

type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = {
  setViewport(v: { width: number; height: number }): Promise<void>;
  goto(url: string, o?: unknown): Promise<unknown>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  evaluate<T>(fn: (...a: never[]) => T | Promise<T>, ...args: unknown[]): Promise<T>;
  close(): Promise<void>;
};

let browserPromise: Promise<Browser> | null = null;

export async function sharedBrowser(chrome: string): Promise<Browser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const pptr = (await import('puppeteer-core')).default as unknown as {
      launch(o: unknown): Promise<Browser>;
    };
    return pptr.launch({
      executablePath: chrome,
      headless: true,
      args: ['--hide-scrollbars', '--disable-lcd-text', '--force-device-scale-factor=1'],
    });
  })();
  return browserPromise;
}

export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

export async function captureDirect(
  htmlPath: string,
  chrome: string,
  viewport: { w: number; h: number },
): Promise<Capture> {
  const code = await extractorBundle();
  const browser = await sharedBrowser(chrome);
  const page = await browser.newPage();
  const started = performance.now();
  try {
    await page.setViewport({ width: viewport.w, height: viewport.h });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.addScriptTag({ content: code });

    const got = await page.evaluate(
      async (args: never) => {
        const { ref, title, vp } = args as unknown as {
          ref: string;
          title: string;
          vp: { w: number; h: number };
        };
        const api = (globalThis as Record<string, unknown>)['FTF'] as {
          extractWithReport?: (r: Element, o: unknown) => Promise<{ tree: unknown; warnings: unknown[] }>;
          extract?: (r: Element, o: unknown) => Promise<unknown>;
          formatWarning?: (w: unknown) => string;
        };
        if (!api) throw new Error('the extractor bundle did not define FTF');

        const options = {
          viewport: vp,
          source: { kind: 'file', ref, title, capturedAt: new Date().toISOString(), viewport: vp },
        };

        const t0 = performance.now();
        let tree: unknown;
        let warnings: unknown[] = [];
        if (api.extractWithReport) {
          const r = await api.extractWithReport(document.body, options);
          tree = r.tree;
          warnings = r.warnings ?? [];
        } else if (api.extract) {
          tree = await api.extract(document.body, options);
        } else {
          throw new Error(`FTF exports no extract(): ${Object.keys(api).join(', ')}`);
        }
        const t1 = performance.now();

        return {
          json: JSON.stringify(tree),
          extractMs: t1 - t0,
          warnings: warnings.map((w) =>
            api.formatWarning ? api.formatWarning(w) : JSON.stringify(w),
          ),
        };
      },
      { ref: htmlPath, title: path.basename(htmlPath), vp: viewport },
    );

    const ms = performance.now() - started;
    return {
      tree: JSON.parse(got.json),
      ms,
      extractMs: got.extractMs,
      via: 'direct',
      warnings: got.warnings,
      stdout: '',
      stderr: '',
    };
  } finally {
    await page.close();
  }
}

/**
 * The CLI when it works, the extractor in the page otherwise. A CLI that is on
 * disk but broken does not stop the assertions from running: the reason is
 * carried back on the capture so the suite can print it.
 */
export async function capture(
  htmlPath: string,
  outPath: string,
  chrome: string,
  viewport: { w: number; h: number },
): Promise<Capture> {
  if (!findCliBin()) return captureDirect(htmlPath, chrome, viewport);
  try {
    return await captureViaCli(htmlPath, outPath, chrome, viewport);
  } catch (e) {
    const direct = await captureDirect(htmlPath, chrome, viewport);
    const why = (e as Error).message.replace(/[\s]+/g, ' ').slice(0, 240);
    return { ...direct, warnings: [...direct.warnings, `cli-failed: ${why}`] };
  }
}
