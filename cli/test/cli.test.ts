import { validateTree } from '@fit-to-figma/tree';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findChrome } from '../src/chrome.js';
import { parseCapture, parseViewport, run, type Io } from '../src/index.js';

/**
 * The CLI end to end: capture a local file, write the tree, validate it back.
 *
 * The capture needs a browser on the machine, so it skips without one. The
 * argument parsing and the validate command do not, and never skip.
 */

const FIXTURE = fileURLToPath(new URL('../../fixtures/phone-screen.html', import.meta.url));

function collect(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (line) => lines.push(line), err: (line) => errors.push(line) };
}

describe('arguments', () => {
  it('reads a viewport', () => {
    expect(parseViewport('390x844')).toEqual({ w: 390, h: 844 });
    expect(() => parseViewport('big')).toThrow(/390x844/);
  });

  it('reads a capture line', () => {
    expect(
      parseCapture(['page.html', '-o', 'out.json', '--viewport', '1440x900', '--full-page']),
    ).toEqual({
      target: 'page.html',
      out: 'out.json',
      viewport: { w: 1440, h: 900 },
      fullPage: true,
    });
  });

  it('refuses a line it does not understand', () => {
    expect(() => parseCapture([])).toThrow(/needs a URL or an HTML file/);
    expect(() => parseCapture(['a.html', '--nope'])).toThrow(/unknown option/);
    expect(() => parseCapture(['a.html', 'b.html'])).toThrow(/one page/);
  });
});

describe('validate', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fit-to-figma-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fails a file that is not a tree, and says where', async () => {
    const file = join(dir, 'not-a-tree.json');
    await writeFile(file, JSON.stringify({ version: 1, root: {} }), 'utf8');

    const io = collect();
    expect(await run(['validate', file], io)).toBe(1);
    expect(io.errors[0]).toContain('not a design tree');
    expect(io.errors.join('\n')).toContain('root.id');
  });

  it('fails a file that is not JSON', async () => {
    const file = join(dir, 'broken.json');
    await writeFile(file, '{oh no', 'utf8');
    const io = collect();
    expect(await run(['validate', file], io)).toBe(1);
  });

  it('wants a file', async () => {
    const io = collect();
    expect(await run(['validate'], io)).toBe(2);
  });
});

const chrome = (() => {
  try {
    return existsSync(FIXTURE) ? findChrome() : null;
  } catch {
    return null;
  }
})();

(chrome ? describe : describe.skip)('capture', () => {
  let dir: string;
  let out: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fit-to-figma-'));
    out = join(dir, 'phone.tree.json');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('captures a local file, writes a tree, and validates it back', async () => {
    const io = collect();
    expect(await run(['capture', FIXTURE, '-o', out, '--viewport', '390x844'], io)).toBe(0);
    expect(existsSync(out)).toBe(true);

    const written = await readFile(out, 'utf8');
    const checked = validateTree(written);
    expect(checked.ok ? [] : checked.errors).toEqual([]);

    // One line: what was written, how big it is, and what it could not do.
    expect(io.lines[0]).toMatch(
      /^phone\.tree\.json · \d+ nodes · .+ of assets · fonts: .+ · \d+ warnings?$/,
    );

    const validated = collect();
    expect(await run(['validate', out], validated)).toBe(0);
    expect(validated.lines[0]).toContain('a design tree, version 1');
  }, 120_000);

  it('says no when the page is not there', async () => {
    const io = collect();
    expect(await run(['capture', join(dir, 'nope.html')], io)).toBe(1);
    expect(io.errors.join('')).toContain('no such file');
  });
});
