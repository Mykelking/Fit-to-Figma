import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame } from './fake-figma.js';
import { frameOf, kids, node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
});

const options = { bindVariables: false, updateById: false };

function root(): FakeFrame {
  return file.page.children[0] as FakeFrame;
}

describe('auto layout', () => {
  it('maps a row with gap, padding and alignment', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            w: 320,
            h: 64,
            layout: {
              mode: 'row',
              gap: 12,
              padding: [8, 16, 8, 16],
              align: 'center',
              justify: 'space-between',
              wrap: true,
            },
          }),
        ),
      ],
      options,
    );

    const f = root();
    expect(f.layoutMode).toBe('HORIZONTAL');
    expect(f.itemSpacing).toBe(12);
    expect([f.paddingTop, f.paddingRight, f.paddingBottom, f.paddingLeft]).toEqual([8, 16, 8, 16]);
    expect(f.counterAxisAlignItems).toBe('CENTER');
    expect(f.primaryAxisAlignItems).toBe('SPACE_BETWEEN');
    expect(f.layoutWrap).toBe('WRAP');
  });

  it('maps a column and the three simple justifications', async () => {
    for (const [justify, expected] of [
      ['start', 'MIN'],
      ['center', 'CENTER'],
      ['end', 'MAX'],
    ] as const) {
      file = installFigma();
      await build(
        [
          tree(
            node({
              type: 'frame',
              layout: { mode: 'column', gap: 0, padding: [0, 0, 0, 0], align: 'start', justify, wrap: false },
            }),
          ),
        ],
        options,
      );
      expect(root().layoutMode).toBe('VERTICAL');
      expect(root().primaryAxisAlignItems).toBe(expected);
    }
  });

  it('leaves a frame with no layout absolute and places children relative to it', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            id: 'r',
            x: 100,
            y: 200,
            w: 300,
            h: 300,
            children: [
              node({ type: 'frame', id: 'a', x: 120, y: 240, w: 50, h: 50 }),
              node({ type: 'frame', id: 'b', x: 180, y: 300, w: 50, h: 50 }),
            ],
          }),
        ),
      ],
      options,
    );

    const f = root();
    expect(f.layoutMode).toBe('NONE');
    const [a, b] = kids(f);
    expect([a?.x, a?.y]).toEqual([20, 40]);
    expect([b?.x, b?.y]).toEqual([80, 100]);
  });

  it('keeps paint order', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            children: [
              node({ type: 'frame', name: 'first' }),
              node({ type: 'frame', name: 'second' }),
              node({ type: 'frame', name: 'third' }),
            ],
          }),
        ),
      ],
      options,
    );
    expect(kids(root()).map((k) => k.name)).toEqual(['first', 'second', 'third']);
  });

  it('honours clip and opacity', async () => {
    await build([tree(node({ type: 'frame', clip: true, opacity: 0.4 }))], options);
    expect(root().clipsContent).toBe(true);
    expect(root().opacity).toBeCloseTo(0.4);
  });
});

describe('sizing', () => {
  it('sets fill and hug under an auto layout parent', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            layout: { mode: 'row', gap: 0, padding: [0, 0, 0, 0], align: 'start', justify: 'start', wrap: false },
            children: [
              node({
                type: 'frame',
                name: 'filler',
                sizing: { w: 'fill', h: 'fixed' },
              }),
              node({
                type: 'frame',
                name: 'hugger',
                sizing: { w: 'hug', h: 'hug' },
                layout: { mode: 'row', gap: 0, padding: [0, 0, 0, 0], align: 'start', justify: 'start', wrap: false },
              }),
            ],
          }),
        ),
      ],
      options,
    );

    const [filler, hugger] = kids(root());
    expect(filler?.layoutSizingHorizontal).toBe('FILL');
    expect(filler?.layoutSizingVertical).toBe('FIXED');
    expect(hugger?.layoutSizingHorizontal).toBe('HUG');
    expect(hugger?.layoutSizingVertical).toBe('HUG');
  });

  it('does not try to set sizing under an absolute parent', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            children: [node({ type: 'frame', name: 'child', sizing: { w: 'fill', h: 'fill' } })],
          }),
        ),
      ],
      options,
    );
    expect(kids(root())[0]?.layoutSizingHorizontal).toBe('FIXED');
    expect(report.warnings).toEqual([]);
  });

  it('reports a sizing Figma refuses instead of failing the run', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            layout: { mode: 'row', gap: 0, padding: [0, 0, 0, 0], align: 'start', justify: 'start', wrap: false },
            children: [node({ type: 'frame', name: 'plain', sizing: { w: 'hug', h: 'fixed' } })],
          }),
        ),
      ],
      options,
    );
    expect(report.nodes).toBe(2);
    expect(report.warnings.join(' ')).toContain('sizing hug');
  });
});

describe('the root frame', () => {
  it('is named from the source title and sits at the viewport centre', async () => {
    figma.viewport.center = { x: 500, y: 400 };
    await build([tree(node({ type: 'frame', w: 300, h: 200, name: 'body' }), { source: { kind: 'file', ref: 'a.html', title: 'Sign in', capturedAt: '', viewport: { w: 390, h: 844 } } })], options);
    const f = frameOf(root());
    expect(f.name).toBe('Sign in');
    expect(f.x).toBe(350);
    expect(f.y).toBe(300);
  });

  it('lays several trees out side by side', async () => {
    await build(
      [
        tree(node({ type: 'frame', w: 200, h: 100, name: 'one' })),
        tree(node({ type: 'frame', w: 200, h: 100, name: 'two' })),
      ],
      options,
    );
    expect(file.page.children.length).toBe(2);
    const gap = (file.page.children[1] as FakeFrame).x - (file.page.children[0] as FakeFrame).x;
    expect(gap).toBe(320);
  });
});
