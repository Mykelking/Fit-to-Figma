import type { DesignTree } from '@fit-to-figma/tree';
import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame, FakePage } from './fake-figma.js';
import { node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
  figma.viewport.center = { x: 0, y: 0 };
});

function sample(id: string, page?: string, place?: { x: number; y: number }) {
  const extra: Partial<DesignTree> = {};
  if (page !== undefined) extra.page = page;
  if (place) extra.place = place;
  return tree(node({ type: 'frame', id, name: 'body', w: 400, h: 800 }), extra);
}

function named(name: string): FakePage {
  return file.pages.filter((p) => p.name === name)[0] as FakePage;
}

function frames(name: string): FakeFrame[] {
  return named(name).children as FakeFrame[];
}

const plain = { bindVariables: false, updateById: false };

describe('page', () => {
  it('makes the page a tree names and builds on it', async () => {
    await build([sample('a', 'Screens')], plain);
    expect(file.pages.map((p) => p.name)).toEqual(['Page 1', 'Screens']);
    expect(file.page.children).toHaveLength(0);
    expect(frames('Screens')).toHaveLength(1);
  });

  it('takes the page that is already there rather than a second one', async () => {
    await build([sample('a', 'Screens'), sample('b', 'Screens')], plain);
    expect(file.pages).toHaveLength(2);
    expect(frames('Screens')).toHaveLength(2);
  });

  it('a tree with no page builds where you are, as before', async () => {
    await build([sample('a')], plain);
    expect(file.pages).toHaveLength(1);
    expect(file.page.children).toHaveLength(1);
  });

  it('place is read on the named page too', async () => {
    await build([sample('a', 'Screens', { x: 400, y: -20 })], plain);
    expect([frames('Screens')[0]?.x, frames('Screens')[0]?.y]).toEqual([400, -20]);
  });

  it('each page lays its own unplaced trees out from the centre', async () => {
    await build([sample('a', 'Screens'), sample('b', 'Screens'), sample('c', 'Flows')], plain);
    const here = frames('Screens');
    expect((here[1]?.x ?? 0) - (here[0]?.x ?? 0)).toBe(520);
    expect(frames('Flows')[0]?.x).toBe(-200);
  });

  it('updating by id looks on the page the tree names', async () => {
    await build([sample('a', 'Screens')], plain);
    figma.currentPage = file.page as unknown as PageNode;
    const report = await build([sample('a', 'Screens')], { bindVariables: false, updateById: true });
    expect(report.framesUpdated).toBe(1);
    expect(frames('Screens')).toHaveLength(1);
    expect(file.page.children).toHaveLength(0);
  });

  it('leaves you on the first page a run named, selecting what landed there', async () => {
    await build([sample('a'), sample('b', 'Flows'), sample('c', 'Screens')], plain);
    expect(figma.currentPage.name).toBe('Flows');
    expect(named('Flows').selection).toHaveLength(1);
  });

  it('stays where it is when no tree names a page', async () => {
    await build([sample('a'), sample('b')], plain);
    expect(figma.currentPage).toBe(file.page);
    expect(file.page.selection).toHaveLength(2);
  });
});
