import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { FakeFrame, installFigma } from './fake-figma.js';
import type { FakeFile } from './fake-figma.js';
import { kids, node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
  figma.viewport.center = { x: 0, y: 0 };
});

function page(): FakeFrame[] {
  return file.page.children as FakeFrame[];
}

function sample(name: string) {
  return tree(
    node({
      type: 'frame',
      id: 'screen-1',
      name: 'body',
      w: 390,
      h: 844,
      children: [node({ type: 'frame', name })],
    }),
    { source: { kind: 'file', ref: 'a.html', title: 'Home', capturedAt: '', viewport: { w: 390, h: 844 } } },
  );
}

describe('update existing frames by id', () => {
  it('writes fitId and the source on the root frame', async () => {
    await build([sample('one')], { bindVariables: false, updateById: false });
    expect(page()[0]?.getPluginData('fitId')).toBe('screen-1');
    expect(page()[0]?.getPluginData('fitSource')).toBe('a.html');
  });

  it('replaces the match in place, keeping its position, parent and index', async () => {
    await build([sample('one')], { bindVariables: false, updateById: false });
    const before = page()[0] as FakeFrame;
    before.x = 1234;
    before.y = 56;
    const neighbour = new FakeFrame(file);
    neighbour.name = 'someone else';
    file.page.appendChild(neighbour);

    const report = await build([sample('two')], { bindVariables: false, updateById: true });

    expect(report.framesUpdated).toBe(1);
    expect(report.framesCreated).toBe(0);
    expect(page()).toHaveLength(2);
    const now = page()[0] as FakeFrame;
    expect(now).not.toBe(before);
    expect(before.removed).toBe(true);
    expect([now.x, now.y]).toEqual([1234, 56]);
    expect(kids(now).map((k) => k.name)).toEqual(['two']);
  });

  it('adds a frame when nothing matches', async () => {
    await build([sample('one')], { bindVariables: false, updateById: false });
    const other = tree(node({ type: 'frame', id: 'screen-2', name: 'body' }));
    const report = await build([other], { bindVariables: false, updateById: true });
    expect(report.framesUpdated).toBe(0);
    expect(report.framesCreated).toBe(1);
    expect(page()).toHaveLength(2);
  });

  it('adds rather than replaces when the option is off', async () => {
    await build([sample('one')], { bindVariables: false, updateById: false });
    const report = await build([sample('two')], { bindVariables: false, updateById: false });
    expect(report.framesCreated).toBe(1);
    expect(page()).toHaveLength(2);
  });

  it('leaves the new frame selected', async () => {
    await build([sample('one')], { bindVariables: false, updateById: false });
    expect(file.page.selection).toHaveLength(1);
    expect(file.page.selection[0]).toBe(page()[0]);
  });
});
