import type { DesignTree, Node as TreeNode } from '@fit-to-figma/tree';
import type { FakeFrame, FakeNode } from './fake-figma.js';
import { FakeContainer } from './fake-figma.js';

let n = 0;

export function node(partial: Partial<TreeNode> & { type: TreeNode['type'] }): TreeNode {
  n += 1;
  return {
    id: partial.id ?? 'n' + n,
    name: partial.name ?? 'node ' + n,
    x: 0,
    y: 0,
    w: 100,
    h: 40,
    ...partial,
  } as TreeNode;
}

export function tree(root: TreeNode, extra: Partial<DesignTree> = {}): DesignTree {
  return {
    version: 1,
    source: {
      kind: 'file',
      ref: 'page.html',
      title: 'Page',
      capturedAt: '2026-01-01T00:00:00Z',
      viewport: { w: 390, h: 844 },
    },
    fonts: [],
    assets: {},
    tokens: [],
    root,
    ...extra,
  } as DesignTree;
}

export function kids(parent: FakeNode): FakeNode[] {
  return parent instanceof FakeContainer ? parent.children : [];
}

export function frameOf(parent: FakeNode): FakeFrame {
  return parent as FakeFrame;
}

/** A one by one transparent PNG, base64, for image tests. */
export const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export const SVG_TICK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 8l4 4 8-8"/></svg>';
