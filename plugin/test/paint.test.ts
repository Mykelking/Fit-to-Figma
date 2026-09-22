import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { gradientTransform } from '../src/main/paint.js';
import { decodeBase64 } from '../src/main/assets.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame, FakeNode } from './fake-figma.js';
import { PNG_1X1, SVG_TICK, kids, node, tree } from './helpers.js';

const options = { bindVariables: false, updateById: false };
let file: FakeFile;

beforeEach(() => {
  file = installFigma();
});

function root(): FakeFrame {
  return file.page.children[0] as FakeFrame;
}

describe('images and vectors', () => {
  it('makes a rectangle with an image fill, sized to the box', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            children: [node({ type: 'image', asset: 'a1', w: 120, h: 80 })],
          }),
          { assets: { a1: { type: 'image', mime: 'image/png', data: PNG_1X1, w: 1, h: 1 } } },
        ),
      ],
      options,
    );
    const rect = kids(root())[0] as FakeNode;
    expect(rect.type).toBe('RECTANGLE');
    expect([rect.width, rect.height]).toEqual([120, 80]);
    expect(rect.fills).toEqual([{ type: 'IMAGE', imageHash: 'img1', scaleMode: 'FILL' }]);
    expect(file.images).toHaveLength(1);
    expect(report.images).toBe(1);
  });

  it('makes one Figma image however many nodes paint with the asset', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            children: [
              node({ type: 'image', asset: 'a1', w: 10, h: 10 }),
              node({ type: 'image', asset: 'a1', w: 20, h: 20 }),
            ],
          }),
          { assets: { a1: { type: 'image', mime: 'image/png', data: PNG_1X1, w: 1, h: 1 } } },
        ),
      ],
      options,
    );
    expect(file.images).toHaveLength(1);
  });

  it('skips an image whose asset is missing and carries on', async () => {
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            children: [
              node({ type: 'image', name: 'gone', asset: 'nope', w: 10, h: 10 }),
              node({ type: 'frame', name: 'after' }),
            ],
          }),
        ),
      ],
      options,
    );
    expect(kids(root()).map((k) => k.name)).toEqual(['gone', 'after']);
    expect(report.assetsSkipped).toBe(1);
    expect(report.warnings.join(' ')).toContain('skipped');
  });

  it('makes a vector from svg markup and sizes it', async () => {
    const report = await build(
      [
        tree(
          node({ type: 'frame', children: [node({ type: 'vector', asset: 'v1', w: 24, h: 24 })] }),
          { assets: { v1: { type: 'svg', mime: 'image/svg+xml', data: SVG_TICK, w: 16, h: 16 } } },
        ),
      ],
      options,
    );
    const vector = kids(root())[0] as FakeFrame;
    expect(vector.svg).toBe(SVG_TICK);
    expect([vector.width, vector.height]).toEqual([24, 24]);
    expect(report.vectors).toBe(1);
  });

  it('decodes base64 without atob', () => {
    expect(Array.from(decodeBase64('QUJD'))).toEqual([65, 66, 67]);
    expect(decodeBase64(PNG_1X1).slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47]));
  });
});

describe('fills, strokes, radii and effects', () => {
  it('paints a solid with its opacity', async () => {
    await build([tree(node({ type: 'frame', fills: [{ type: 'solid', color: '#9c4679', opacity: 0.5 }] }))], options);
    expect(root().fills).toEqual([
      { type: 'SOLID', color: { r: 156 / 255, g: 70 / 255, b: 121 / 255 }, opacity: 0.5 },
    ]);
  });

  it('turns a linear gradient into stops and a transform', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            fills: [
              {
                type: 'linear',
                angle: 90,
                stops: [
                  { at: 0, color: '#000000', opacity: 1 },
                  { at: 1, color: '#ffffff', opacity: 0.5 },
                ],
              },
            ],
          }),
        ),
      ],
      options,
    );
    const fill = (root().fills as Array<Record<string, unknown>>)[0];
    expect(fill?.type).toBe('GRADIENT_LINEAR');
    expect((fill?.gradientStops as unknown[]).length).toBe(2);
  });

  it('points a 90 degree gradient along x', () => {
    const t = gradientTransform(90);
    expect(t[0][0]).toBeCloseTo(1);
    expect(t[0][1]).toBeCloseTo(0);
  });

  it('sets stroke weight and align', async () => {
    await build(
      [tree(node({ type: 'frame', strokes: { color: '#000000', opacity: 1, weight: 2, align: 'outside' } }))],
      options,
    );
    expect(root().strokeWeight).toBe(2);
    expect(root().strokeAlign).toBe('OUTSIDE');
    expect(root().strokes).toHaveLength(1);
  });

  it('drops a zero weight stroke', async () => {
    await build(
      [tree(node({ type: 'frame', strokes: { color: '#000000', opacity: 1, weight: 0, align: 'inside' } }))],
      options,
    );
    expect(root().strokes).toEqual([]);
  });

  it('sets four corner radii', async () => {
    await build([tree(node({ type: 'frame', radius: [1, 2, 3, 4] }))], options);
    const f = root();
    expect([f.topLeftRadius, f.topRightRadius, f.bottomRightRadius, f.bottomLeftRadius]).toEqual([1, 2, 3, 4]);
  });

  it('maps drop and inner shadows and both blurs', async () => {
    await build(
      [
        tree(
          node({
            type: 'frame',
            effects: [
              { type: 'shadow', x: 0, y: 2, blur: 8, spread: 1, color: '#000000', opacity: 0.2 },
              { type: 'inner-shadow', x: 1, y: 1, blur: 4, spread: 0, color: '#000000', opacity: 0.3 },
              { type: 'blur', radius: 12 },
              { type: 'backdrop-blur', radius: 6 },
            ],
          }),
        ),
      ],
      options,
    );
    const effects = root().effects as Array<Record<string, unknown>>;
    expect(effects.map((e) => e.type)).toEqual(['DROP_SHADOW', 'INNER_SHADOW', 'LAYER_BLUR', 'BACKGROUND_BLUR']);
    expect(effects[0]?.offset).toEqual({ x: 0, y: 2 });
    expect(effects[0]?.radius).toBe(8);
    expect(effects[0]?.spread).toBe(1);
    expect((effects[0]?.color as { a: number }).a).toBeCloseTo(0.2);
  });
});
