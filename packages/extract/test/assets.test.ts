// @vitest-environment happy-dom
import { flatten, type Node } from '@fit-to-figma/tree';
import { describe, expect, it, vi } from 'vitest';
import { extractWithReport } from '../src/index.js';
import { mount } from './dom.js';

/**
 * Backgrounds, and what happens when the bytes behind one are not reachable.
 */

/** One transparent pixel, so nothing has to be fetched to run this. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function find(root: Node, cls: string): Node | undefined {
  return flatten(root).find((node) => node.semantic?.classes?.includes(cls));
}

describe('backgrounds', () => {
  it('inlines a background image as an asset and points a fill at it', async () => {
    const root = mount({
      body: `<div class="hero" data-rect="0,0,300,150"
               style="background-image:url('${PIXEL}');background-size:cover"></div>`,
    });
    const { tree } = await extractWithReport(root);

    const hero = find(tree.root, 'hero');
    const fill = hero?.fills?.find((paint) => paint.type === 'image');
    expect(fill).toBeDefined();
    expect(fill?.type === 'image' && fill.scale).toBe('fill');

    const id = fill?.type === 'image' ? fill.asset : '';
    expect(tree.assets[id]?.type).toBe('image');
    expect(tree.assets[id]?.mime).toBe('image/png');
  });

  it('reads contain as fit', async () => {
    const root = mount({
      body: `<div class="hero" data-rect="0,0,300,150"
               style="background-image:url('${PIXEL}');background-size:contain"></div>`,
    });
    const { tree } = await extractWithReport(root);
    const fill = find(tree.root, 'hero')?.fills?.find((paint) => paint.type === 'image');
    expect(fill?.type === 'image' && fill.scale).toBe('fit');
  });

  it('puts the colour under the image, the way CSS paints them', async () => {
    const root = mount({
      body: `<div class="hero" data-rect="0,0,300,150"
               style="background-color:#9c4679;background-image:url('${PIXEL}')"></div>`,
    });
    const { tree } = await extractWithReport(root);
    const fills = find(tree.root, 'hero')?.fills ?? [];
    expect(fills[0]).toEqual({ type: 'solid', color: '#9c4679', opacity: 1 });
    expect(fills[1]?.type).toBe('image');
  });

  it('turns a gradient into a linear fill', async () => {
    const root = mount({
      body: `<div class="card" data-rect="0,0,300,150"
               style="background-image:linear-gradient(90deg, #9c4679 0%, #4a2f6e 100%)"></div>`,
    });
    const { tree } = await extractWithReport(root);
    expect(find(tree.root, 'card')?.fills?.[0]).toEqual({
      type: 'linear',
      angle: 90,
      stops: [
        { at: 0, color: '#9c4679', opacity: 1 },
        { at: 1, color: '#4a2f6e', opacity: 1 },
      ],
    });
  });

  it('falls back to a placeholder and says where the image was', async () => {
    // Nothing leaves the machine in a test: the fetch is the thing that fails.
    const fetching = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no route to host'));

    const root = mount({
      body: `<img class="shot" data-rect="0,0,200,120" src="https://example.invalid/shot.png">`,
    });
    const { tree, warnings } = await extractWithReport(root);
    fetching.mockRestore();

    const shot = find(tree.root, 'shot');
    expect(shot?.type).toBe('image');
    expect(shot?.asset).toBeUndefined();
    expect(shot?.fills?.[0]?.type).toBe('solid');
    expect((shot?.semantic as { src?: string } | undefined)?.src).toBe(
      'https://example.invalid/shot.png',
    );
    expect(warnings.map((warning) => warning.code)).toContain('asset-fetch-failed');
  });

  it('stops inlining once the budget is spent', async () => {
    const root = mount({
      body: `<img class="shot" data-rect="0,0,200,120" src="${PIXEL}">`,
    });
    const { tree, warnings } = await extractWithReport(root, { assetBudgetBytes: 4 });
    expect(Object.keys(tree.assets)).toHaveLength(0);
    expect(warnings.map((warning) => warning.code)).toContain('asset-budget-exceeded');
  });
});

describe('tokens', () => {
  it('lifts custom properties off the root and types them', async () => {
    const root = mount({
      css: `:root { --color-primary: #9c4679; --radius-pill: 24px; --font-stack: Inter, sans-serif; }`,
      body: `<div data-rect="0,0,100,20">hello</div>`,
    });
    const { tree } = await extractWithReport(root);
    const byName = Object.fromEntries(tree.tokens.map((token) => [token.name, token]));

    expect(byName['--color-primary']).toEqual({
      name: '--color-primary',
      value: '#9c4679',
      kind: 'color',
    });
    expect(byName['--radius-pill']?.kind).toBe('number');
    expect(byName['--font-stack']?.kind).toBe('string');
  });
});
