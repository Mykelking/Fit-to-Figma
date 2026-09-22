import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame } from './fake-figma.js';
import { kids, node, tree } from './helpers.js';

const options = { bindVariables: false, updateById: false };
let file: FakeFile;

beforeEach(() => {
  file = installFigma();
});

function root(): FakeFrame {
  return file.page.children[0] as FakeFrame;
}

describe('one bad node is skipped and the run continues', () => {
  it('keeps the siblings after a node Figma refuses to make', async () => {
    // The third node the fake is asked for throws: the middle child.
    file = installFigma({ breakOn: (_kind, made) => made === 3 });
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            name: 'body',
            children: [
              node({ type: 'frame', name: 'first' }),
              node({ type: 'frame', name: 'bad' }),
              node({ type: 'frame', name: 'last' }),
            ],
          }),
        ),
      ],
      options,
    );
    expect(kids(root()).map((k) => k.name)).toEqual(['first', 'last']);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('bad');
    expect(report.nodes).toBe(3);
  });

  it('drops a broken subtree without touching the rest of the page', async () => {
    file = installFigma({ breakOn: (_kind, made) => made === 2 });
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            name: 'body',
            children: [
              node({ type: 'frame', name: 'bad', children: [node({ type: 'frame', name: 'buried' })] }),
              node({ type: 'frame', name: 'good' }),
            ],
          }),
        ),
      ],
      options,
    );
    expect(kids(root()).map((k) => k.name)).toEqual(['good']);
    expect(report.warnings.join(' ')).toContain('bad');
  });

  it('survives a tree with no root', async () => {
    const report = await build([{ version: 1 } as never], options);
    expect(report.warnings.join(' ')).toContain('no root');
    expect(report.nodes).toBe(0);
  });
});

describe('unknown input is ignored, never fatal', () => {
  it('draws a node of an unknown type as a frame and keeps its name', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            children: [node({ type: 'canvas' as never, name: 'chart', w: 50, h: 50 })],
          }),
        ),
      ],
      options,
    );
    const child = kids(root())[0];
    expect(child?.type).toBe('FRAME');
    expect(child?.name).toBe('chart');
    expect(report.warnings).toEqual([]);
  });

  it('ignores fields it does not know and a fill type it cannot draw', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            fills: [{ type: 'conic', color: '#000000' } as never, { type: 'solid', color: '#ff0000', opacity: 1 }],
            glimmer: 7,
          } as never),
        ),
      ],
      options,
    );
    expect((root().fills as Array<Record<string, unknown>>).map((f) => f.type)).toEqual(['SOLID']);
    expect(report.warnings).toEqual([]);
  });

  it('keeps a node with a missing or silly box drawable', async () => {
    await build([tree(node({ type: 'frame', w: 0, h: Number.NaN as never }))], options);
    expect(root().width).toBe(1);
    expect(root().height).toBe(1);
  });

  it('keeps the tree name on every layer for a later component pass', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            name: 'body',
            semantic: { tag: 'body', classes: ['page'] },
            children: [node({ type: 'frame', name: 'button.btn.btn--primary', semantic: { tag: 'button', classes: ['btn', 'btn--primary'] } })],
          }),
        ),
      ],
      options,
    );
    expect(kids(root())[0]?.name).toBe('button.btn.btn--primary');
  });
});

describe('batching', () => {
  it('yields and reports progress every batch', async () => {
    const children = Array.from({ length: 25 }, (_, i) => node({ type: 'frame', name: 'c' + i }));
    const seen: Array<[number, number]> = [];
    const report = await build([tree(node({ type: 'frame', name: 'body', children }))], {
      ...options,
      batchSize: 10,
    }, { onProgress: (done, total) => seen.push([done, total]) });

    expect(report.nodes).toBe(26);
    expect(seen.map((s) => s[0])).toEqual([10, 20]);
    expect(seen[0]?.[1]).toBe(26);
  });
});
