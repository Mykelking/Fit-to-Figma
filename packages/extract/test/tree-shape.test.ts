// @vitest-environment happy-dom
import { findById, flatten, validateTree, type Node } from '@fit-to-figma/tree';
import { beforeEach, describe, expect, it } from 'vitest';
import { extractWithReport } from '../src/index.js';
import { mount } from './dom.js';

/**
 * The shape of the tree a page becomes: what is kept, what is dropped, and
 * what the frames say about how their children are laid out.
 */

const CSS = `
  .screen { display: flex; flex-direction: column; gap: 16px; padding: 16px; background: #f6f4f8; }
  .row { display: flex; flex-direction: row; gap: 12px; align-items: center;
         justify-content: space-between; background: #ffffff; border-radius: 16px; padding: 12px; }
  .gone { display: none; }
  .see-through { visibility: hidden; }
`;

const BODY = `
  <div class="screen" data-rect="0,0,390,240">
    <div class="row" data-rect="16,16,358,60">
      <span class="name" data-rect="28,36,120,20">Ada Okafor</span>
      <span class="amount" data-rect="280,36,80,20">-$40.00</span>
    </div>
    <div class="gone">never drawn</div>
    <div class="see-through" data-rect="16,90,358,20">hidden by visibility</div>
    <div class="collapsed" data-rect="0,0,0,0">
      <span class="kept" data-rect="16,120,200,20">promoted to the parent</span>
    </div>
    <div class="off" data-rect="-9999,0,100,20">off canvas</div>
  </div>
`;

function named(tree: { root: Node }, name: string): Node | undefined {
  return flatten(tree.root).find((node) => node.semantic?.classes?.includes(name));
}

describe('the shape of the tree', () => {
  let result: Awaited<ReturnType<typeof extractWithReport>>;

  beforeEach(async () => {
    const root = mount({ css: CSS, body: BODY });
    result = await extractWithReport(root);
  });

  it('is a design tree', () => {
    const checked = validateTree(result.tree);
    expect(checked.ok ? [] : checked.errors).toEqual([]);
  });

  it('puts the root at the origin', () => {
    expect(result.tree.root.x).toBe(0);
    expect(result.tree.root.y).toBe(0);
    expect(result.tree.root.w).toBe(390);
  });

  it('turns a nested flex container into layout', () => {
    const screen = named(result.tree, 'screen');
    expect(screen?.layout).toEqual({
      mode: 'column',
      gap: 16,
      padding: [16, 16, 16, 16],
      align: 'stretch',
      justify: 'start',
      wrap: false,
    });

    const row = named(result.tree, 'row');
    expect(row?.layout).toMatchObject({
      mode: 'row',
      gap: 12,
      align: 'center',
      justify: 'space-between',
    });
  });

  it('takes the boxes from layout, not from the stylesheet', () => {
    const row = named(result.tree, 'row');
    expect({ x: row?.x, y: row?.y, w: row?.w, h: row?.h }).toEqual({
      x: 16,
      y: 16,
      w: 358,
      h: 60,
    });
  });

  it('paints the background colour it was given', () => {
    expect(named(result.tree, 'screen')?.fills).toEqual([
      { type: 'solid', color: '#f6f4f8', opacity: 1 },
    ]);
  });

  it('drops what display none, visibility hidden and off canvas hide', () => {
    expect(named(result.tree, 'gone')).toBeUndefined();
    expect(named(result.tree, 'see-through')).toBeUndefined();
    expect(named(result.tree, 'off')).toBeUndefined();
  });

  it('hands the children of a zero sized wrapper to its parent', () => {
    expect(named(result.tree, 'collapsed')).toBeUndefined();
    const kept = named(result.tree, 'kept');
    expect(kept?.type).toBe('text');
    expect(kept?.text?.content).toBe('promoted to the parent');

    const screen = named(result.tree, 'screen');
    expect(screen?.children?.some((child) => child.id === kept?.id)).toBe(true);
  });

  it('collapses a frame that only holds text into the text', () => {
    const name = named(result.tree, 'name');
    expect(name?.type).toBe('text');
    expect(name?.text?.content).toBe('Ada Okafor');
    expect(name?.children).toBeUndefined();
  });

  it('carries semantic on every node', () => {
    const row = named(result.tree, 'row');
    expect(row?.semantic).toMatchObject({ tag: 'div', classes: ['row'] });
  });

  it('gives the same ids on a second run of the same page', async () => {
    const again = await extractWithReport(mount({ css: CSS, body: BODY }));
    const ids = (tree: { root: Node }) => flatten(tree.root).map((node) => node.id);
    expect(ids(again.tree)).toEqual(ids(result.tree));
  });

  it('gives every node an id of its own', () => {
    const ids = flatten(result.tree.root).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(findById(result.tree, id)).toBeDefined();
  });

  it('stops at maxDepth and says so', async () => {
    const shallow = await extractWithReport(mount({ css: CSS, body: BODY }), { maxDepth: 1 });
    expect(shallow.warnings.map((warning) => warning.code)).toContain('max-depth-reached');
    expect(flatten(shallow.tree.root).length).toBeLessThan(
      flatten(result.tree.root).length,
    );
  });

  it('marks a box the browser took out of the flow', async () => {
    const out = await extractWithReport(
      mount({
        css: CSS,
        body: `
          <div class="screen" data-rect="0,0,390,240">
            <div class="in-flow" data-rect="16,16,358,60">in the flow</div>
            <div class="float" style="position: absolute" data-rect="306,164,56,56">+</div>
            <div class="stuck" style="position: sticky" data-rect="16,90,358,20">stuck</div>
          </div>
        `,
      }),
    );
    expect(named(out.tree, 'float')?.flow).toBe('absolute');
    expect(named(out.tree, 'stuck')?.flow).toBe('absolute');
    expect(named(out.tree, 'in-flow')?.flow).toBeUndefined();
  });

  it('keeps what the page hid when asked to', async () => {
    const all = await extractWithReport(mount({ css: CSS, body: BODY }), {
      includeHidden: true,
    });
    expect(named(all.tree, 'see-through')).toBeDefined();
  });
});
