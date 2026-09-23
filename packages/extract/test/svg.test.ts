// @vitest-environment happy-dom
import { flatten, type Node } from '@fit-to-figma/tree';
import { describe, expect, it } from 'vitest';
import { extractWithReport } from '../src/index.js';
import { mount } from './dom.js';

/**
 * Inline SVG becomes a vector asset that stands on its own: the sprite it
 * pointed at is inlined, and `currentColor` is the colour it resolved to, so
 * the plugin never needs the page again.
 */

function vectors(root: Node): Node[] {
  return flatten(root).filter((node) => node.type === 'vector');
}

const SPRITE = `
  <svg class="sprite" style="display:none" aria-hidden="true">
    <symbol id="bell" viewBox="0 0 24 24">
      <path class="bell-path" d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z"/>
    </symbol>
  </svg>
`;

describe('inline svg', () => {
  it('inlines what a use points at, and drops the use', async () => {
    const root = mount({
      body: `
        ${SPRITE}
        <button class="icon-btn" data-rect="0,0,40,40">
          <svg class="icon" width="24" height="24" data-rect="8,8,24,24">
            <use href="#bell" fill="currentColor"></use>
          </svg>
        </button>
      `,
    });
    const { tree } = await extractWithReport(root);

    const icon = vectors(tree.root)[0];
    expect(icon).toBeDefined();
    expect(icon?.asset).toBeDefined();

    const asset = tree.assets[icon!.asset!];
    expect(asset?.type).toBe('svg');
    expect(asset?.mime).toBe('image/svg+xml');
    expect(asset?.w).toBe(24);

    const markup = asset?.data ?? '';
    expect(markup).toContain('M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6Z');
    expect(markup).not.toContain('<use');
    expect(markup).not.toContain('currentColor');
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('a stroke only icon keeps its stroke and its empty fill, on the path itself', async () => {
    const root = mount({
      body: `
        <svg class="sprite" style="display:none" aria-hidden="true">
          <symbol id="home" viewBox="0 0 24 24">
            <path d="M3 10 12 3l9 7v11H3V10Z"/>
          </symbol>
        </svg>
        <span style="color: #9c4679" data-rect="0,0,24,24">
          <svg class="icon" style="stroke: currentColor; fill: none; stroke-width: 1.5px" data-rect="0,0,24,24">
            <use href="#home"></use>
          </svg>
        </span>
      `,
    });
    const { tree } = await extractWithReport(root);
    const markup = tree.assets[vectors(tree.root)[0]?.asset ?? '']?.data ?? '';

    expect(markup).toContain('M3 10 12 3l9 7v11H3V10Z');
    expect(markup).toContain('stroke="#9c4679"');
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('stroke-width="1.5"');
    expect(markup).not.toContain('<use');
    expect(markup).not.toContain('currentColor');
    // Nothing is left for a stylesheet or an ancestor to say.
    expect(markup).not.toContain('class="icon"');
  });

  it('says so when a use points at nothing', async () => {
    const root = mount({
      body: `<svg class="icon" data-rect="0,0,24,24"><use href="#missing"></use></svg>`,
    });
    const { warnings, tree } = await extractWithReport(root);
    expect(warnings.map((warning) => warning.code)).toContain('svg-use-unresolved');
    expect(tree.assets[vectors(tree.root)[0]?.asset ?? '']?.data).not.toContain('<use');
  });

  it('does not walk into the svg', async () => {
    const root = mount({
      body: `<svg class="icon" data-rect="0,0,24,24"><circle cx="12" cy="12" r="10"/></svg>`,
    });
    const { tree } = await extractWithReport(root);
    expect(flatten(tree.root).some((node) => node.semantic?.tag === 'circle')).toBe(false);
  });

  it('keeps one asset when the same drawing is used twice', async () => {
    // The id of an asset is a hash of its own markup, so two identical
    // drawings are one entry however many places they appear in.
    const icon = `<svg class="icon" data-rect="0,0,24,24"><circle cx="12" cy="12" r="10"/></svg>`;
    const root = mount({ body: `<span data-rect="0,0,24,24">${icon}</span><span data-rect="0,0,24,24">${icon}</span>` });
    const { tree } = await extractWithReport(root);
    const used = vectors(tree.root).map((node) => node.asset);
    expect(used).toHaveLength(2);
    expect(used[0]).toBe(used[1]);
    expect(Object.keys(tree.assets)).toHaveLength(1);
  });
});
