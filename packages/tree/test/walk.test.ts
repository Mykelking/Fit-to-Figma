import { describe, expect, it } from 'vitest';
import { find, findById, flatten, walk } from '../src/index.js';
import type { Node } from '../src/index.js';
import { validTree } from './fixture.js';

describe('walk', () => {
  it('visits parents before children, in paint order', () => {
    const seen: string[] = [];
    walk(validTree(), (node) => {
      seen.push(node.id);
    });
    expect(seen).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
  });

  it('carries the parent, the depth and the index', () => {
    const rows: Array<[string, string | undefined, number, number]> = [];
    walk(validTree(), (node, visit) => {
      rows.push([node.id, visit.parent?.id, visit.depth, visit.index]);
    });
    expect(rows).toEqual([
      ['n1', undefined, 0, 0],
      ['n2', 'n1', 1, 0],
      ['n3', 'n2', 2, 0],
      ['n4', 'n2', 2, 1],
      ['n5', 'n1', 1, 1],
    ]);
  });

  it('false leaves the children alone', () => {
    const seen: string[] = [];
    walk(validTree(), (node) => {
      seen.push(node.id);
      return node.id !== 'n2';
    });
    expect(seen).toEqual(['n1', 'n2', 'n5']);
  });

  it('takes a bare node as well as a tree', () => {
    const button = validTree().root.children?.[0] as Node;
    expect(flatten(button).map((node) => node.id)).toEqual(['n2', 'n3', 'n4']);
  });

  it('find stops at the first hit', () => {
    const text = find(validTree(), (node) => node.type === 'text');
    expect(text?.id).toBe('n3');
    expect(find(validTree(), () => false)).toBeUndefined();
  });

  it('findById reaches the leaves', () => {
    expect(findById(validTree(), 'n4')?.name).toBe('icon');
    expect(findById(validTree(), 'nope')).toBeUndefined();
  });

  it('a node with no children is not a problem', () => {
    const leaf: Node = { id: 'x', name: 'x', type: 'frame', x: 0, y: 0, w: 1, h: 1 };
    expect(flatten(leaf)).toEqual([leaf]);
  });
});
