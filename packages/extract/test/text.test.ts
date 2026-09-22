// @vitest-environment happy-dom
import { flatten, type Node } from '@fit-to-figma/tree';
import { describe, expect, it } from 'vitest';
import { extractWithReport } from '../src/index.js';
import { mount } from './dom.js';

/**
 * A paragraph whose text is interrupted by an inline child becomes siblings,
 * one per run, each with the font the browser drew that run with.
 *
 * `::before` and `::after` are covered in the real browser test instead:
 * happy-dom's getComputedStyle ignores the pseudo argument, so there is
 * nothing here to read.
 */

const CSS = `
  p { font-family: Inter, sans-serif; font-size: 16px; line-height: 24px; }
  b { font-weight: 700; }
  .pill { text-transform: uppercase; text-decoration: underline; }
`;

function texts(root: Node): Node[] {
  return flatten(root).filter((node) => node.type === 'text');
}

describe('text', () => {
  it('splits a mixed run into siblings', async () => {
    const root = mount({
      css: CSS,
      body: `<p class="line" data-rect="0,0,300,24">plain <b data-rect="44,0,40,24">bold</b> tail</p>`,
    });
    const { tree } = await extractWithReport(root);

    const runs = texts(tree.root);
    expect(runs.map((node) => node.text?.content)).toEqual(['plain ', 'bold', ' tail']);

    const [plain, bold] = runs;
    expect(plain?.text?.font.weight).toBe(400);
    expect(bold?.text?.font.weight).toBe(700);
    expect(bold?.text?.font.family).toBe('Inter');

    // The bold run is a sibling of the plain ones, not a child of them.
    const paragraph = flatten(tree.root).find((node) => node.semantic?.tag === 'p');
    expect(paragraph?.children?.map((child) => child.text?.content)).toEqual([
      'plain ',
      'bold',
      ' tail',
    ]);
  });

  it('keeps one node when the whole element is one run', async () => {
    const root = mount({
      css: CSS,
      body: `<p class="one" data-rect="0,0,300,24">all of it is one run</p>`,
    });
    const { tree } = await extractWithReport(root);
    const runs = texts(tree.root);
    // The element that held the words is the text node. The layer is called
    // after the words; which element held them is in semantic.
    expect(runs).toHaveLength(1);
    expect(runs[0]?.text?.content).toBe('all of it is one run');
    expect(runs[0]?.name).toBe('all of it is one run');
    expect(runs[0]?.semantic).toMatchObject({ tag: 'p', classes: ['one'] });
  });

  it('collapses whitespace the way the browser draws it', async () => {
    const root = mount({
      body: `<p data-rect="0,0,300,24">  lots   of\n   space  </p>`,
    });
    const { tree } = await extractWithReport(root);
    expect(texts(tree.root)[0]?.text?.content).toBe(' lots of space ');
  });

  it('carries the transform rather than applying it', async () => {
    const root = mount({
      css: CSS,
      body: `<span class="pill" data-rect="0,0,120,24">send money</span>`,
    });
    const { tree } = await extractWithReport(root);
    const run = texts(tree.root)[0];
    expect(run?.text?.content).toBe('send money');
    expect(run?.text?.transform).toBe('upper');
    expect(run?.text?.decoration).toBe('underline');
  });

  it('draws what a form control holds', async () => {
    const root = mount({
      body: `<input class="field" data-rect="0,0,200,40" value="Ada Okafor">`,
    });
    const { tree } = await extractWithReport(root);
    expect(texts(tree.root).map((node) => node.text?.content)).toEqual(['Ada Okafor']);
  });

  it('lists the families it drew in, with their weights', async () => {
    const root = mount({
      css: CSS,
      body: `<p data-rect="0,0,300,24">plain <b data-rect="44,0,40,24">bold</b></p>`,
    });
    const { tree } = await extractWithReport(root);
    expect(tree.fonts).toEqual([{ family: 'Inter', weights: [400, 700] }]);
  });
});
