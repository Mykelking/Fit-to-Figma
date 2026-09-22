import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateTree } from '@fit-to-figma/tree';
import type { DesignTree } from '@fit-to-figma/tree';
import { NO_CHROME, findChrome } from './lib/chrome.js';
import { capture, captureViaCli, closeSharedBrowser, tempDir } from './lib/capture.js';
import { allNodes, check, report, type Expect } from './lib/check.js';
import {
  FIXTURE_NAMES,
  VIEWPORTS,
  findCliBin,
  findExtractEntry,
  fixtureExpect,
  fixtureHtml,
  missing,
} from './lib/parts.js';

const chrome = findChrome();
const cli = findCliBin();
const extractor = findExtractEntry();

const readExpect = (n: (typeof FIXTURE_NAMES)[number]) =>
  JSON.parse(readFileSync(fixtureExpect(n), 'utf8')) as Expect;

/** Ids in walk order: the determinism check compares these between two runs. */
const idsOf = (tree: DesignTree) => allNodes(tree).map((n) => n.id);

if (!chrome) {
  describe.skip('extract (no browser)', () => {
    it(NO_CHROME, () => {});
  });
} else if (!cli && !extractor) {
  describe('extract', () => {
    const why = missing('the CLI and the extractor', 'cli/src/bin.ts, packages/extract/src/index.ts');
    for (const name of FIXTURE_NAMES) it.todo(`${name}.html: capture, validate, assert - ${why}`);
  });
} else {
  describe('extract', () => {
    const out = tempDir('extract');
    const trees = new Map<string, DesignTree>();
    const second = new Map<string, DesignTree>();
    const notes: string[] = [];
    let cliNote: string | undefined;
    let via: 'cli' | 'direct' = 'direct';

    beforeAll(async () => {
      for (const name of FIXTURE_NAMES) {
        const vp = VIEWPORTS[name];
        const a = await capture(fixtureHtml(name), path.join(out, `${name}.a.json`), chrome, vp);
        const b = await capture(fixtureHtml(name), path.join(out, `${name}.b.json`), chrome, vp);
        trees.set(name, a.tree as DesignTree);
        second.set(name, b.tree as DesignTree);
        notes.push(
          `${name}: ${a.ms.toFixed(0)}ms wall` +
            (a.extractMs !== null ? `, ${a.extractMs.toFixed(0)}ms in extract()` : '') +
            (a.warnings.length ? `, ${a.warnings.length} warning(s)` : ''),
        );
        const cliFailed = a.warnings.find((w) => w.startsWith('cli-failed:'));
        if (cliFailed && !cliNote) cliNote = cliFailed;
        const own = a.warnings.filter((w) => !w.startsWith('cli-failed:'));
        if (own.length) console.log(`[extract] ${name} warnings: ${own.slice(0, 12).join(' | ')}`);
        via = a.via;
      }
      console.log(
        `[extract] via ${via === 'cli' ? 'the CLI' : 'extract() in the page'}` +
          (cliNote ? ` - the CLI is on disk but did not run: ${cliNote.slice(11, 180)}` : ''),
      );
      console.log(`[extract] ${notes.join('\n[extract] ')}`);
    }, 900_000);

    afterAll(async () => {
      await closeSharedBrowser();
    });

    if (!cli) {
      it.todo(
        `the CLI writes a tree - ${missing('`fit-to-figma capture <file> -o out.json`', 'cli/src/bin.ts')}`,
      );
    } else {
      it(
        '`fit-to-figma capture <file> -o out.json` writes a valid tree',
        async () => {
          const target = path.join(out, 'cli-smoke.json');
          const c = await captureViaCli(fixtureHtml('phone-screen'), target, chrome as string, VIEWPORTS['phone-screen']);
          const r = validateTree(c.tree);
          expect(r.ok, r.ok ? '' : r.errors.map((e) => `${e.path}: ${e.message}`).join('; ')).toBe(true);
        },
        180_000,
      );
    }

    for (const name of FIXTURE_NAMES) {
      describe(`${name}.html`, () => {
        it('the capture is a valid design tree', () => {
          const tree = trees.get(name);
          expect(tree, 'nothing was captured').toBeTruthy();
          const r = validateTree(tree);
          if (!r.ok) {
            throw new Error(
              `validateTree rejected ${name}:\n` +
                r.errors.slice(0, 40).map((e) => `  ${e.path}: ${e.message} (${e.code})`).join('\n') +
                (r.errors.length > 40 ? `\n  ... and ${r.errors.length - 40} more` : ''),
            );
          }
        });

        it('every assertion in the .expect.json holds', () => {
          const tree = trees.get(name) as DesignTree;
          const fails = check(tree, readExpect(name), `${name}.expect.json`);
          expect(fails.length, `\n${report(fails)}\n`).toBe(0);
        });

        it('two runs give identical ids', () => {
          const a = trees.get(name) as DesignTree;
          const b = second.get(name) as DesignTree;
          const ia = idsOf(a);
          const ib = idsOf(b);
          expect(ib.length, 'the two runs did not produce the same number of nodes').toBe(ia.length);
          const drift = ia.map((id, i) => (id === ib[i] ? null : `${i}: ${id} -> ${ib[i]}`)).filter(Boolean);
          expect(drift.slice(0, 20), `${drift.length} id(s) moved between runs`).toEqual([]);
        });
      });
    }
  });
}
