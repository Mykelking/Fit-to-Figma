import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame } from './fake-figma.js';
import { node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
  figma.viewport.center = { x: 0, y: 0 };
});

function page(): FakeFrame[] {
  return file.page.children as FakeFrame[];
}

function sample(id: string, place?: { x: number; y: number }) {
  const extra = place ? { place } : {};
  return tree(node({ type: 'frame', id, name: 'body', w: 400, h: 800 }), extra);
}

describe('place', () => {
  it('puts a new frame where the tree asks, rounded', async () => {
    await build([sample('a', { x: 240.4, y: -80.6 })], { bindVariables: false, updateById: false });
    expect([page()[0]?.x, page()[0]?.y]).toEqual([240, -81]);
  });

  it('centres a tree with no place, as before', async () => {
    await build([sample('a')], { bindVariables: false, updateById: false });
    expect([page()[0]?.x, page()[0]?.y]).toEqual([-200, -400]);
  });

  it('a placed tree does not move the unplaced ones along', async () => {
    await build([sample('a'), sample('b', { x: 5000, y: 5000 }), sample('c')], {
      bindVariables: false,
      updateById: false,
    });
    const [a, b, c] = page();
    expect([a?.x, a?.y]).toEqual([-200, -400]);
    expect([b?.x, b?.y]).toEqual([5000, 5000]);
    expect([c?.x, c?.y]).toEqual([-200 + 520, -400]);
  });

  it('an existing frame keeps its own position, place or not', async () => {
    await build([sample('a')], { bindVariables: false, updateById: false });
    const before = page()[0] as FakeFrame;
    before.x = 11;
    before.y = 22;
    await build([sample('a', { x: 5000, y: 5000 })], { bindVariables: false, updateById: true });
    expect([page()[0]?.x, page()[0]?.y]).toEqual([11, 22]);
  });

  it('a place that is not two numbers is ignored', async () => {
    const bad = sample('a') as unknown as Record<string, unknown>;
    bad['place'] = { x: 'far', y: 10 };
    await build([bad as never], { bindVariables: false, updateById: false });
    expect([page()[0]?.x, page()[0]?.y]).toEqual([-200, -400]);
  });
});
