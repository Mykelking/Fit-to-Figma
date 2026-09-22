import { flatten, validateTree, type DesignTree, type Node } from '@fit-to-figma/tree';
import { extractBundle, findChrome } from 'fit-to-figma';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, type Browser } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The same extractor, in a real browser, against a real fixture.
 *
 * The test DOM covers the rules; this covers the things only a browser can
 * answer: where the boxes actually are, what `::before` draws, what
 * `currentColor` resolves to, and what a stylesheet computes to.
 *
 * It needs a Chrome, Chromium or Edge on the machine. Without one it says so
 * and skips rather than failing, because that is an environment, not a bug.
 */

const FIXTURE = fileURLToPath(new URL('../../../fixtures/phone-screen.html', import.meta.url));

let chrome: string | null = null;
try {
  chrome = existsSync(FIXTURE) ? findChrome() : null;
} catch {
  chrome = null;
}

const when = chrome ? describe : describe.skip;

when('a real browser', () => {
  let browser: Browser;
  let tree: DesignTree;
  let warnings: Array<{ code: string }>;

  beforeAll(async () => {
    browser = await launch({
      executablePath: chrome as string,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--allow-file-access-from-files'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(FIXTURE).href, { waitUntil: 'networkidle2' });
    await page.addScriptTag({ content: await extractBundle() });

    const result = (await page.evaluate(async () => {
      const api = (globalThis as unknown as {
        __fitToFigma: { extract(options: unknown): Promise<unknown> };
      }).__fitToFigma;
      return JSON.parse(JSON.stringify(await api.extract({ viewport: { w: 390, h: 844 } })));
    })) as { tree: DesignTree; warnings: Array<{ code: string }> };

    tree = result.tree;
    warnings = result.warnings;
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const byClass = (cls: string): Node | undefined =>
    flatten(tree.root).find((node) => node.semantic?.classes?.includes(cls));

  it('produces a tree the schema accepts', () => {
    const checked = validateTree(tree);
    expect(checked.ok ? [] : checked.errors).toEqual([]);
  });

  it('lays the screen out the way the page did', () => {
    const screen = byClass('screen');
    expect(screen?.layout).toMatchObject({ mode: 'column' });
    expect(screen?.w).toBe(390);
    expect(screen?.h).toBeGreaterThanOrEqual(844);
  });

  it('reads a flex row off the browser, not the stylesheet', () => {
    const statusBar = byClass('status-bar');
    expect(statusBar?.layout).toMatchObject({
      mode: 'row',
      justify: 'space-between',
      align: 'center',
      padding: [12, 16, 12, 16],
    });
    expect(statusBar?.y).toBe(0);
    expect(statusBar?.x).toBe(0);
  });

  it('turns the card gradient into a linear fill through a custom property', () => {
    const card = byClass('card');
    const fill = card?.fills?.find((paint) => paint.type === 'linear');
    expect(fill).toBeDefined();
    expect(fill?.type === 'linear' && fill.stops[0]?.color).toBe('#9c4679');
    expect(card?.radius).toEqual([20, 20, 20, 20]);
    expect(card?.effects?.[0]).toMatchObject({ type: 'shadow', y: 8, blur: 24 });
  });

  it('measures text from the text, with the font the browser used', () => {
    const amount = flatten(tree.root).find((node) => node.text?.content === '$2,480.00');
    expect(amount?.type).toBe('text');
    expect(amount?.text?.font).toMatchObject({ size: 32, lineHeight: 40, weight: 700 });
    expect(amount?.text?.color).toBe('#ffffff');
    expect(amount?.w).toBeGreaterThan(0);
    expect(amount?.w).toBeLessThan(390);
  });

  it('makes each inline svg a vector asset that stands on its own', () => {
    const vectors = flatten(tree.root).filter((node) => node.type === 'vector');
    expect(vectors.length).toBeGreaterThanOrEqual(6);
    for (const vector of vectors) {
      const asset = tree.assets[vector.asset ?? ''];
      expect(asset?.type).toBe('svg');
      expect(asset?.data).not.toContain('currentColor');
    }
  });

  it('resolves currentColor to the colour the page drew', () => {
    const active = flatten(tree.root).find(
      (node) => node.type === 'vector' && node.semantic?.classes?.includes('tab-icon'),
    );
    const markup = tree.assets[active?.asset ?? '']?.data ?? '';
    expect(markup).toContain('rgb(156, 70, 121)');
  });

  it('lifts the custom properties off :root', () => {
    const byName = Object.fromEntries(tree.tokens.map((token) => [token.name, token]));
    expect(byName['--color-primary']).toMatchObject({ value: '#9c4679', kind: 'color' });
    expect(byName['--radius-pill']).toMatchObject({ value: '24px', kind: 'number' });
  });

  it('names the families it drew in', () => {
    expect(tree.fonts.map((font) => font.family)).toContain('Inter');
  });

  it('says what it captured', () => {
    expect(tree.source.kind).toBe('file');
    expect(tree.source.title).toBe('Phone screen');
    expect(tree.source.viewport).toEqual({ w: 390, h: 844 });
  });

  it('gives the same ids twice over', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(FIXTURE).href, { waitUntil: 'networkidle2' });
    await page.addScriptTag({ content: await extractBundle() });
    const again = (await page.evaluate(async () => {
      const api = (globalThis as unknown as {
        __fitToFigma: { extract(options: unknown): Promise<unknown> };
      }).__fitToFigma;
      return JSON.parse(JSON.stringify(await api.extract({ viewport: { w: 390, h: 844 } })));
    })) as { tree: DesignTree };
    await page.close();

    expect(flatten(again.tree.root).map((node) => node.id)).toEqual(
      flatten(tree.root).map((node) => node.id),
    );
  }, 60_000);

  it('raises nothing it cannot explain', () => {
    for (const warning of warnings) expect(typeof warning.code).toBe('string');
  });

  /**
   * The things the fixture does not do, on pages small enough to read here.
   * They need a browser too: a pseudo element and a scroll container only
   * exist once something has been laid out.
   */
  describe('and the rest of the rules', () => {
    async function treeOf(html: string): Promise<{ tree: DesignTree; warnings: Array<{ code: string }> }> {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.addScriptTag({ content: await extractBundle() });
      const result = (await page.evaluate(async () => {
        const api = (globalThis as unknown as {
          __fitToFigma: { extract(options: unknown): Promise<unknown> };
        }).__fitToFigma;
        return JSON.parse(
          JSON.stringify(await api.extract({ viewport: { w: 390, h: 844 } })),
        );
      })) as { tree: DesignTree; warnings: Array<{ code: string }> };
      await page.close();
      return result;
    }

    it('makes ::before and ::after content that is text a text node', async () => {
      const result = await treeOf(`
        <style>
          .badge::before { content: "New "; font-weight: 700; }
          .badge::after { content: " \\2192"; }
        </style>
        <span class="badge">offer</span>
      `);
      const contents = flatten(result.tree.root)
        .filter((node) => node.type === 'text')
        .map((node) => node.text?.content);
      expect(contents).toContain('New ');
      expect(contents).toContain(' →');
      expect(result.warnings.map((warning) => warning.code)).toContain(
        'pseudo-position-approximated',
      );
    }, 30_000);

    it('drops what a scroll container buries and keeps what it half shows', async () => {
      const result = await treeOf(`
        <style>
          .scroller { width: 200px; height: 100px; overflow: auto; }
          .row { height: 60px; background: #9c4679; }
        </style>
        <div class="scroller">
          <div class="row one">ROW-ONE</div>
          <div class="row two">ROW-TWO</div>
          <div class="row three">ROW-THREE</div>
        </div>
      `);
      const at = (cls: string) =>
        flatten(result.tree.root).find((node) => node.semantic?.classes?.includes(cls));
      const contents = flatten(result.tree.root).map((node) => node.text?.content);

      // The container clips, so what hangs out of it is not cropped: row two
      // spans 60 to 120 in a box that shows 100, and stays 60 tall.
      expect(at('scroller')?.clip).toBe(true);
      expect(at('one')?.h).toBe(60);
      expect(at('two')?.h).toBe(60);
      expect(contents).toContain('ROW-TWO');

      // Row three is 120 to 180, entirely below what shows, and goes.
      expect(at('three')).toBeUndefined();
      expect(contents).not.toContain('ROW-THREE');
    }, 30_000);

    it('drops an off-canvas element and everything in it', async () => {
      const result = await treeOf(`
        <div style="position:absolute;left:-9999px;top:-9999px;width:200px;height:40px">
          <span class="buried">MARKER-OFF-CANVAS</span>
        </div>
        <p class="here">on the page</p>
      `);
      const contents = flatten(result.tree.root).map((node) => node.text?.content);
      expect(contents).toContain('on the page');
      expect(contents).not.toContain('MARKER-OFF-CANVAS');
      expect(
        flatten(result.tree.root).some((node) => node.semantic?.classes?.includes('buried')),
      ).toBe(false);
    }, 30_000);

    it('never collapses a chain of wrappers', async () => {
      const result = await treeOf(`
        <div class="a"><div class="b"><span class="c">bottom of the well</span></div></div>
      `);
      const at = (cls: string) =>
        flatten(result.tree.root).find((node) => node.semantic?.classes?.includes(cls));
      expect(at('a')?.type).toBe('frame');
      expect(at('b')?.type).toBe('frame');
      expect(at('c')?.type).toBe('text');
      expect(at('c')?.name).toBe('bottom of the well');
      expect(at('c')?.text?.content).toBe('bottom of the well');
    }, 30_000);

    it('keeps a painted element that holds text as a frame with one text child', async () => {
      const result = await treeOf(`
        <span class="badge" style="background:#9c4679;color:#fff;padding:4px 8px;border-radius:6px">New</span>
      `);
      const badge = flatten(result.tree.root).find((node) =>
        node.semantic?.classes?.includes('badge'),
      );
      expect(badge?.type).toBe('frame');
      expect(badge?.fills?.[0]).toMatchObject({ type: 'solid', color: '#9c4679' });
      expect(badge?.children).toHaveLength(1);
      expect(badge?.children?.[0]?.type).toBe('text');
      expect(badge?.children?.[0]?.text?.content).toBe('New');
    }, 30_000);

    it('says so when the sides of a border differ', async () => {
      const result = await treeOf(`
        <div style="width:100px;height:40px;border-left:4px solid #9c4679;border-bottom:1px solid #000000"></div>
      `);
      expect(result.warnings.map((warning) => warning.code)).toContain('non-uniform-border');
    }, 30_000);

    it('says so when an element is rotated', async () => {
      const result = await treeOf(`
        <div style="width:100px;height:40px;background:#9c4679;transform:rotate(12deg)"></div>
      `);
      expect(result.warnings.map((warning) => warning.code)).toContain('transform-ignored');
    }, 30_000);

    it('inlines an img as an image asset', async () => {
      const pixel =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
      const result = await treeOf(`<img class="shot" width="80" height="40" src="${pixel}">`);
      const shot = flatten(result.tree.root).find((node) =>
        node.semantic?.classes?.includes('shot'),
      );
      expect(shot?.type).toBe('image');
      expect(result.tree.assets[shot?.asset ?? '']?.mime).toBe('image/png');
    }, 30_000);
  });
});
