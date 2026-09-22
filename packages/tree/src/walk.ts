import type { DesignTree, Node } from './types.js';

export interface WalkVisit {
  node: Node;
  parent: Node | undefined;
  /** 0 at the root. */
  depth: number;
  /** Where this node sits in its parent's `children`; 0 at the root. */
  index: number;
}

/**
 * Return `false` from the visitor to leave this node's children alone.
 * Anything else, including nothing, carries on.
 */
export type Visitor = (node: Node, visit: WalkVisit) => void | boolean;

/** Depth first, parents before children, children in paint order. */
export function walk(tree: DesignTree | Node, visit: Visitor): void {
  const root: Node = 'root' in tree ? tree.root : tree;
  step(root, undefined, 0, 0, visit);
}

function step(
  node: Node,
  parent: Node | undefined,
  depth: number,
  index: number,
  visit: Visitor,
): void {
  const carryOn = visit(node, { node, parent, depth, index });
  if (carryOn === false) return;
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child) step(child, node, depth + 1, i, visit);
  }
}

/** Every node in walk order, as an array. */
export function flatten(tree: DesignTree | Node): Node[] {
  const out: Node[] = [];
  walk(tree, (node) => {
    out.push(node);
  });
  return out;
}

/** The first node the test likes, or undefined. */
export function find(
  tree: DesignTree | Node,
  test: (node: Node, visit: WalkVisit) => boolean,
): Node | undefined {
  let hit: Node | undefined;
  walk(tree, (node, visit) => {
    if (hit) return false;
    if (test(node, visit)) {
      hit = node;
      return false;
    }
    return true;
  });
  return hit;
}

/** Node by id, or undefined. Ids are unique across a tree. */
export function findById(tree: DesignTree | Node, id: string): Node | undefined {
  return find(tree, (node) => node.id === id);
}
