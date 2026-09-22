import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { DesignTree } from '@fit-to-figma/tree';
import { NO_CHROME, findChrome } from './lib/chrome.js';
import { capture, captureDirect, closeSharedBrowser, tempDir } from './lib/capture.js';
import { allNodes } from './lib/check.js';
import { ROOT, VIEWPORTS, findCliBin, findExtractEntry, fixtureHtml, missing } from './lib/parts.js';

const EXTRACT_BUDGET_MS = 2_000;
const BUILD_BUDGET_MS = 5_000;

const chrome = findChrome();
const cli = findCliBin();
const extractor = findExtractEntry();
const haveFake = existsSync(path.join(ROOT, 'plugin', 'test', 'fake-figma.ts'));
const haveBuilder = existsSync(path.join(ROOT, 'plugin', 'src', 'main', 'build.ts'));

if (!chrome) {
  describe.skip('perf (no browser)', () => {
    it(NO_CHROME, () => {});
  });
} else {
  describe('perf - edge-cases.html, 1,500 small nodes', () => {
    afterAll(async () => {
      await closeSharedBrowser();
    });

    if (!cli && !extractor) {
      it.todo(
        `extracts in under ${EXTRACT_BUDGET_MS}ms - ${missing('the CLI', 'cli/dist/bin.js, cli/src/bin.ts')}`,
      );
      it.todo(
        `builds in under ${BUILD_BUDGET_MS}ms in the fake - ${missing('the CLI', 'cli/dist/bin.js, cli/src/bin.ts')}`,
      );
    } else {
      it(
        `extracts in under ${EXTRACT_BUDGET_MS}ms`,
        async () => {
          // The budget is for extraction. Going through the CLI would also time
          // node booting, esbuild and Chrome launching, so this drives extract()
          // in the page and times that alone; a warm run first loads the page.
          const vp = VIEWPORTS['edge-cases'];
          await captureDirect(fixtureHtml('edge-cases'), chrome, vp); // warm the page
          // Best of three: the budget is the extractor's cost, not whatever else
          // the machine was doing during one sample.
          const runs: number[] = [];
          let n = 0;
          for (let i = 0; i < 3; i++) {
            const c = await captureDirect(fixtureHtml('edge-cases'), chrome, vp);
            runs.push(c.extractMs ?? c.ms);
            n = allNodes(c.tree as DesignTree).length;
          }
          const ms = Math.min(...runs);
          console.log(
            `[perf] extract: best ${ms.toFixed(0)}ms of [${runs.map((r) => r.toFixed(0)).join(', ')}]` +
              ` for ${n} nodes (budget ${EXTRACT_BUDGET_MS}ms)`,
          );
          expect(n, 'the 1,500 small nodes did not all arrive').toBeGreaterThan(1500);
          expect(ms, `extract took ${ms.toFixed(0)}ms`).toBeLessThan(EXTRACT_BUDGET_MS);
        },
        900_000,
      );

      if (!haveFake || !haveBuilder) {
        const why = !haveFake
          ? missing('the fake `figma` global', 'plugin/test/fake-figma.ts')
          : missing('the plugin builder', 'plugin/src/main/build.ts');
        it.todo(`builds in under ${BUILD_BUDGET_MS}ms in the fake - ${why}`);
      } else {
        it(
          `builds in under ${BUILD_BUDGET_MS}ms in the fake`,
          async () => {
            const out = tempDir('perf-build');
            const c = await capture(fixtureHtml('edge-cases'), path.join(out, 'tree.json'), chrome, VIEWPORTS['edge-cases']);
            const tree = c.tree as DesignTree;

            const { installFigma } = await import('../plugin/test/fake-figma.js');
            const { build } = await import('../plugin/src/main/build.js');

            installFigma();
            const started = performance.now();
            const report = await build([tree], { bindVariables: true, updateById: false, batchSize: 500 });
            const ms = performance.now() - started;
            console.log(`[perf] build: ${ms.toFixed(0)}ms for ${report.nodes} nodes (budget ${BUILD_BUDGET_MS}ms)`);
            expect(ms, `build took ${ms.toFixed(0)}ms`).toBeLessThan(BUILD_BUDGET_MS);
          },
          900_000,
        );
      }
    }
  });
}
