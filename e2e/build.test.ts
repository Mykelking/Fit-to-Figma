import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DesignTree } from '@fit-to-figma/tree';
import { NO_CHROME, findChrome } from './lib/chrome.js';
import { capture, closeSharedBrowser, tempDir } from './lib/capture.js';
import { allNodes } from './lib/check.js';
import { FIXTURE_NAMES, ROOT, VIEWPORTS, findCliBin, findExtractEntry, fixtureHtml, missing } from './lib/parts.js';

const chrome = findChrome();
const cli = findCliBin();
const extractor = findExtractEntry();
const fakeFile = path.join(ROOT, 'plugin', 'test', 'fake-figma.ts');
const builderFile = path.join(ROOT, 'plugin', 'src', 'main', 'build.ts');
const haveFake = existsSync(fakeFile);
const haveBuilder = existsSync(builderFile);

function countTree(tree: DesignTree): Record<string, number> {
  const out: Record<string, number> = { frame: 0, text: 0, image: 0, vector: 0 };
  for (const n of allNodes(tree)) out[n.type] = (out[n.type] ?? 0) + 1;
  return out;
}

const blocked =
  !cli && !extractor ? missing('the CLI and the extractor', 'cli/src/bin.ts, packages/extract/src/index.ts')
  : !haveFake ? missing('the fake `figma` global', 'plugin/test/fake-figma.ts')
  : !haveBuilder ? missing('the plugin builder', 'plugin/src/main/build.ts')
  : null;

if (!chrome) {
  describe.skip('build (no browser)', () => {
    it(NO_CHROME, () => {});
  });
} else if (blocked) {
  describe('build', () => {
    for (const name of FIXTURE_NAMES) {
      it.todo(`${name}: node counts by type match the tree - ${blocked}`);
      it.todo(`${name}: text nodes carry the fonts - ${blocked}`);
      it.todo(`${name}: a second run updates in place rather than duplicating - ${blocked}`);
    }
  });
} else {
  describe('build', () => {
    const trees = new Map<string, DesignTree>();
    let installFigma!: typeof import('../plugin/test/fake-figma.js')['installFigma'];
    let build!: typeof import('../plugin/src/main/build.js')['build'];

    const options = { bindVariables: true, updateById: true, batchSize: 500 };

    beforeAll(async () => {
      ({ installFigma } = await import('../plugin/test/fake-figma.js'));
      ({ build } = await import('../plugin/src/main/build.js'));

      const out = tempDir('build');
      for (const name of FIXTURE_NAMES) {
        const c = await capture(fixtureHtml(name), path.join(out, `${name}.json`), chrome as string, VIEWPORTS[name]);
        trees.set(name, c.tree as DesignTree);
      }
    }, 900_000);

    afterAll(async () => {
      await closeSharedBrowser();
    });

    for (const name of FIXTURE_NAMES) {
      describe(`${name}.html`, () => {
        it('node counts by type match the tree', async () => {
          const tree = trees.get(name) as DesignTree;
          installFigma();
          const report = await build([tree], options);

          const want = countTree(tree);
          const total = want['frame'] + want['text'] + want['image'] + want['vector'];
          expect(
            {
              nodes: report.nodes,
              frames: report.frames,
              texts: report.texts,
              images: report.images,
              vectors: report.vectors,
            },
            `warnings: ${report.warnings.join(' | ') || 'none'}`,
          ).toEqual({
            nodes: total,
            frames: want['frame'],
            texts: want['text'],
            images: want['image'],
            vectors: want['vector'],
          });
        });

        it('text nodes carry the fonts', async () => {
          const tree = trees.get(name) as DesignTree;
          const file = installFigma();
          const report = await build([tree], options);

          const texts = file.page.findAll((n) => n.type === 'TEXT') as unknown as {
            fontName: { family: string; style: string };
            characters: string;
          }[];
          expect(texts.length, 'no TEXT nodes were built').toBe(report.texts);

          const built = new Set(texts.map((t) => t.fontName.family));
          const wanted = new Set(
            allNodes(tree)
              .filter((n) => n.type === 'text')
              .map((n) => n.text?.font.family)
              .filter((f): f is string => Boolean(f)),
          );
          // A family Figma does not have must fall back to Inter and be reported once.
          const missingFamilies = new Set(report.fontsMissing);
          const unaccounted = [...wanted].filter((f) => !built.has(f) && !missingFamilies.has(f));
          expect(unaccounted, `built families: ${[...built].join(', ')}; reported missing: ${[...missingFamilies].join(', ') || 'none'}`).toEqual([]);

          // Every font a text node wears was loaded before it was worn.
          for (const t of texts) {
            expect(
              file.loadedFonts.some((f) => f.family === t.fontName.family && f.style === t.fontName.style),
              `${t.fontName.family} ${t.fontName.style} was set without being loaded`,
            ).toBe(true);
          }
        });

        it('a second run updates in place rather than duplicating', async () => {
          const tree = trees.get(name) as DesignTree;
          const file = installFigma();

          const first = await build([tree], options);
          const afterFirst = file.page.findAll(() => true).length;
          const topFirst = file.page.children.length;

          const second = await build([tree], options);
          const afterSecond = file.page.findAll(() => true).length;
          const topSecond = file.page.children.length;

          expect(topSecond, `the page went from ${topFirst} to ${topSecond} top level frames`).toBe(topFirst);
          expect(
            afterSecond,
            `the file went from ${afterFirst} to ${afterSecond} nodes; ` +
              `framesCreated=${second.framesCreated} framesUpdated=${second.framesUpdated} ` +
              `(first run created ${first.framesCreated})`,
          ).toBe(afterFirst);
          expect(second.framesUpdated, 'the second run reported no update in place').toBeGreaterThan(0);
        });
      });
    }
  });
}
