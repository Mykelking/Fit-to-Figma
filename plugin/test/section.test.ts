import type { DesignTree } from '@fit-to-figma/tree';
import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame, FakeSection } from './fake-figma.js';
import { node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
  figma.viewport.center = { x: 0, y: 0 };
});

function sample(id: string, extra: Partial<DesignTree> = {}) {
  return tree(node({ type: 'frame', id, name: 'body', w: 400, h: 800 }), extra);
}

function section(name: string): FakeSection {
  return file.sections.filter((s) => s.name === name)[0] as FakeSection;
}

function inside(name: string): FakeFrame[] {
  return section(name).children as FakeFrame[];
}

const plain = { bindVariables: false, updateById: false };

describe('section', () => {
  it('makes one section for a name and puts every frame in it', async () => {
    await build([sample('a', { section: 'Onboarding' }), sample('b', { section: 'Onboarding' })], plain);
    expect(file.sections).toHaveLength(1);
    expect(inside('Onboarding')).toHaveLength(2);
    expect(file.page.children).toEqual([section('Onboarding')]);
    expect(file.page.selection).toHaveLength(2);
  });

  it('lays unplaced frames out beside each other, from the padding', async () => {
    await build([sample('a', { section: 'Onboarding' }), sample('b', { section: 'Onboarding' })], plain);
    expect(inside('Onboarding').map((f) => [f.x, f.y])).toEqual([
      [80, 80],
      [600, 80],
    ]);
    // 400 + 120 + 400 wide, 800 tall, and 80 of air on every side.
    expect([section('Onboarding').width, section('Onboarding').height]).toEqual([1080, 960]);
  });

  it('reads place inside the section, not on the page', async () => {
    await build(
      [
        sample('a', { section: 'Flows', place: { x: 0, y: 0 } }),
        sample('b', { section: 'Flows', place: { x: 1000, y: 400 } }),
      ],
      plain,
    );
    expect(inside('Flows').map((f) => [f.x, f.y])).toEqual([
      [80, 80],
      [1080, 480],
    ]);
  });

  it('a new section starts under everything already on the page', async () => {
    await build([sample('a')], plain);
    await build([sample('b', { section: 'Later' })], plain);
    const made = section('Later');
    // The frame on the page is 400 x 800 from (-200, -400), so its foot is 400.
    expect([made.x + 80, made.y + 80]).toEqual([-200, 640]);
  });

  it('a second section does not land on the first', async () => {
    await build([sample('a', { section: 'One' })], plain);
    await build([sample('b', { section: 'Two' })], plain);
    const one = section('One');
    expect(section('Two').y).toBeGreaterThanOrEqual(one.y + one.height);
  });

  it('finds a frame that lives in a section and updates it where it is', async () => {
    await build([sample('a', { section: 'One' })], plain);
    const was = inside('One')[0] as FakeFrame;
    const at = [was.x, was.y];
    const report = await build([sample('a', { section: 'One' })], { bindVariables: false, updateById: true });
    expect(report.framesUpdated).toBe(1);
    expect(file.sections).toHaveLength(1);
    expect(inside('One')).toHaveLength(1);
    expect([inside('One')[0]?.x, inside('One')[0]?.y]).toEqual(at);
  });

  it('puts the section on the page the tree names', async () => {
    await build([sample('a', { page: 'Screens', section: 'Onboarding' })], plain);
    expect(section('Onboarding').parent?.name).toBe('Screens');
    expect(file.page.children).toHaveLength(0);
  });

  it('a tree with no section behaves as before', async () => {
    await build([sample('a')], plain);
    expect(file.sections).toHaveLength(0);
    expect((file.page.children[0] as FakeFrame).x).toBe(-200);
  });
});
