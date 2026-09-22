import type { DesignTree, Node } from '@fit-to-figma/tree';

/** One assertion that did not hold. The list of these is the deliverable. */
export interface Failure {
  file: string;
  node: string;
  expected: unknown;
  got: unknown;
}

export interface Expect {
  fixture: string;
  what?: string;
  viewport?: { w?: number; h?: number };
  counts?: Record<string, number | { min?: number; max?: number }>;
  assets?: Record<string, number | { min?: number; max?: number }>;
  fonts?: { family: string; weights: number[] }[];
  tokens?: { name: string; value: string; kind: string }[];
  mustExist?: [string, string][];
  mustNotExist?: string[];
  textNodes?: string[];
  textNodesAny?: string[][];
  textNodesAbsent?: string[];
  nameCounts?: Record<string, number>;
  depth?: { of: string; min?: number; max?: number };
  assetContains?: Record<string, string[]>;
  nodes?: Record<string, NodeExpect>;
}

export interface NodeExpect {
  layout?: unknown;
  noLayout?: boolean;
  radius?: unknown;
  effects?: unknown;
  text?: unknown;
  strokes?: unknown;
  sizing?: unknown;
  fillTypes?: string[];
}

const NUM_TOL = 0.51;
const OPACITY_TOL = 0.006;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every node in the tree, root first. */
export function allNodes(tree: DesignTree): Node[] {
  const out: Node[] = [];
  const stack: Node[] = [tree.root];
  while (stack.length) {
    const n = stack.pop() as Node;
    out.push(n);
    if (n.children) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as Node);
  }
  return out;
}

export function depthOf(tree: DesignTree, name: string): number | null {
  let found: number | null = null;
  const visit = (n: Node, d: number) => {
    if (found !== null) return;
    if (n.name === name) { found = d; return; }
    for (const c of n.children ?? []) visit(c, d + 1);
  };
  visit(tree.root, 1);
  return found;
}

function near(a: unknown, b: unknown, key?: string): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    const tol = key === 'opacity' ? OPACITY_TOL : NUM_TOL;
    return Math.abs(a - b) <= tol;
  }
  return false;
}

/** Deep compare, tolerant about float noise and about whitespace in text content. */
function same(expected: unknown, got: unknown, key?: string): boolean {
  if (near(expected, got, key)) return true;
  if (typeof expected === 'string' && typeof got === 'string') {
    return key === 'content' ? norm(expected) === norm(got) : expected === got;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(got) || got.length !== expected.length) return false;
    return expected.every((e, i) => same(e, got[i], key));
  }
  if (expected && typeof expected === 'object') {
    if (!got || typeof got !== 'object' || Array.isArray(got)) return false;
    const e = expected as Record<string, unknown>;
    const g = got as Record<string, unknown>;
    // Only the keys the expectation names are compared; extra fields are fine.
    return Object.keys(e).every((k) => same(e[k], g[k], k));
  }
  return expected === got;
}

function inRange(n: number, want: number | { min?: number; max?: number }): boolean {
  if (typeof want === 'number') return n === want;
  if (want.min !== undefined && n < want.min) return false;
  if (want.max !== undefined && n > want.max) return false;
  return true;
}

const show = (v: number | { min?: number; max?: number }) =>
  typeof v === 'number' ? v : `${v.min ?? '-'}..${v.max ?? '-'}`;

/**
 * Check one captured tree against its .expect.json.
 * Returns every assertion that did not hold, rather than throwing on the first.
 */
export function check(tree: DesignTree, exp: Expect, file: string): Failure[] {
  const f: Failure[] = [];
  const add = (node: string, expected: unknown, got: unknown) => f.push({ file, node, expected, got });

  const nodes = allNodes(tree);
  const byName = new Map<string, Node[]>();
  for (const n of nodes) {
    const list = byName.get(n.name);
    if (list) list.push(n);
    else byName.set(n.name, [n]);
  }

  // ---- viewport
  if (exp.viewport) {
    const vp = tree.source?.viewport;
    for (const k of ['w', 'h'] as const) {
      const want = exp.viewport[k];
      if (want === undefined) continue;
      if (!vp || !near(want, vp[k])) add('source.viewport', `${k} = ${want}`, vp ? `${k} = ${vp[k]}` : 'no viewport');
    }
  }

  // ---- counts by node type
  if (exp.counts) {
    const got: Record<string, number> = { frame: 0, text: 0, image: 0, vector: 0 };
    for (const n of nodes) got[n.type] = (got[n.type] ?? 0) + 1;
    for (const [type, want] of Object.entries(exp.counts)) {
      const have = got[type] ?? 0;
      if (!inRange(have, want)) add(`counts.${type}`, show(want), have);
    }
  }

  // ---- asset counts by kind
  if (exp.assets) {
    const got: Record<string, number> = { image: 0, svg: 0 };
    for (const a of Object.values(tree.assets ?? {})) got[a.type] = (got[a.type] ?? 0) + 1;
    for (const [kind, want] of Object.entries(exp.assets)) {
      const have = got[kind] ?? 0;
      if (!inRange(have, want)) add(`assets.${kind}`, show(want), have);
    }
  }

  // ---- asset payload spot checks
  if (exp.assetContains) {
    for (const [kind, needles] of Object.entries(exp.assetContains)) {
      const pool = Object.values(tree.assets ?? {}).filter((a) => a.type === kind);
      for (const needle of needles) {
        if (!pool.some((a) => String(a.data).includes(needle))) {
          add(`assets[${kind}].data`, `some asset contains ${JSON.stringify(needle)}`, `none of ${pool.length} did`);
        }
      }
    }
  }

  // ---- fonts
  if (exp.fonts) {
    for (const want of exp.fonts) {
      const got = (tree.fonts ?? []).find((x) => x.family === want.family);
      if (!got) {
        add('fonts', want.family, `families: ${(tree.fonts ?? []).map((x) => x.family).join(', ') || 'none'}`);
        continue;
      }
      const a = [...want.weights].sort((x, y) => x - y).join(',');
      const b = [...(got.weights ?? [])].sort((x, y) => x - y).join(',');
      if (a !== b) add(`fonts[${want.family}].weights`, `[${a}]`, `[${b}]`);
    }
  }

  // ---- tokens
  if (exp.tokens) {
    for (const want of exp.tokens) {
      const got = (tree.tokens ?? []).find((t) => t.name === want.name);
      if (!got) {
        add('tokens', want.name, `names: ${(tree.tokens ?? []).map((t) => t.name).join(', ') || 'none'}`);
        continue;
      }
      if (norm(got.value).toLowerCase() !== norm(want.value).toLowerCase()) {
        add(`tokens[${want.name}].value`, want.value, got.value);
      }
      if (got.kind !== want.kind) add(`tokens[${want.name}].kind`, want.kind, got.kind);
    }
  }

  // ---- names that must be there, with their type
  for (const [name, type] of exp.mustExist ?? []) {
    const hits = byName.get(name);
    if (!hits) add(name, `exists as ${type}`, 'no node with that name');
    else if (!hits.some((n) => n.type === type)) {
      add(name, `type ${type}`, `type ${[...new Set(hits.map((n) => n.type))].join('/')}`);
    }
  }

  // ---- names that must not be there
  for (const name of exp.mustNotExist ?? []) {
    const hits = byName.get(name);
    if (hits) add(name, 'dropped', `${hits.length} node(s) kept`);
  }

  // ---- text content
  const contents = new Set(nodes.filter((n) => n.type === 'text').map((n) => norm(n.text?.content ?? '')));
  for (const want of exp.textNodes ?? []) {
    if (!contents.has(norm(want))) add(`text ${JSON.stringify(want)}`, 'a text node with this content', 'not found');
  }
  for (const alts of exp.textNodesAny ?? []) {
    if (!alts.some((a) => contents.has(norm(a)))) {
      add(`text any-of ${JSON.stringify(alts)}`, 'one of these as a text node', 'none found');
    }
  }
  for (const want of exp.textNodesAbsent ?? []) {
    const hit = [...contents].find((c) => c.includes(norm(want)));
    if (hit !== undefined) add(`text ${JSON.stringify(want)}`, 'dropped', `present as ${JSON.stringify(hit)}`);
  }

  // ---- how many nodes carry a name
  for (const [name, want] of Object.entries(exp.nameCounts ?? {})) {
    const have = byName.get(name)?.length ?? 0;
    if (have !== want) add(`count of ${name}`, want, have);
  }

  // ---- nesting was not flattened
  if (exp.depth) {
    const d = depthOf(tree, exp.depth.of);
    if (d === null) add(`depth of ${exp.depth.of}`, `>= ${exp.depth.min}`, 'node not found');
    else if (exp.depth.min !== undefined && d < exp.depth.min) add(`depth of ${exp.depth.of}`, `>= ${exp.depth.min}`, d);
    else if (exp.depth.max !== undefined && d > exp.depth.max) add(`depth of ${exp.depth.of}`, `<= ${exp.depth.max}`, d);
  }

  // ---- the chosen nodes, field by field
  for (const [name, want] of Object.entries(exp.nodes ?? {})) {
    const node = byName.get(name)?.[0];
    if (!node) {
      add(name, 'a node with this name', 'not found');
      continue;
    }
    if (want.noLayout && node.layout !== undefined) add(`${name}.layout`, 'absent (not flex, not grid)', node.layout);
    for (const key of ['layout', 'radius', 'effects', 'text', 'strokes', 'sizing'] as const) {
      const w = want[key];
      if (w === undefined) continue;
      const g = (node as unknown as Record<string, unknown>)[key];
      if (!same(w, g, key)) add(`${name}.${key}`, w, g ?? 'absent');
    }
    if (want.fillTypes) {
      const g = (node.fills ?? []).map((p) => p.type);
      if (g.join(',') !== want.fillTypes.join(',')) add(`${name}.fills`, want.fillTypes, g.length ? g : 'absent');
    }
  }

  return f;
}

/** Render failures the way the report wants them: file, node, expected, got. */
export function report(fs: Failure[]): string {
  if (!fs.length) return 'no failures';
  const one = (x: Failure) =>
    `  ${x.file} | ${x.node}\n      expected: ${JSON.stringify(x.expected)}\n      got:      ${JSON.stringify(x.got)}`;
  return `${fs.length} assertion(s) failed:\n${fs.map(one).join('\n')}`;
}
