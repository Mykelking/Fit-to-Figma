import { describe, expect, it } from 'vitest';
import { designTreeSchema, validateNode, validateTree } from '../src/index.js';
import type { DesignTree } from '../src/index.js';
import { clone, drop, put, validTree } from './fixture.js';

describe('validateTree', () => {
  it('passes a complete tree', () => {
    const result = validateTree(validTree());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.tree.root.children).toHaveLength(2);
  });

  it('passes the same tree as JSON text', () => {
    const result = validateTree(JSON.stringify(validTree()));
    expect(result.ok).toBe(true);
  });

  it('names the root when the text is not JSON', () => {
    const result = validateTree('{ nope');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe('(root)');
      expect(result.errors[0]?.code).toBe('invalid_json');
    }
  });

  const required = [
    'version',
    'source',
    'source.kind',
    'source.ref',
    'source.title',
    'source.capturedAt',
    'source.viewport',
    'source.viewport.w',
    'source.viewport.h',
    'fonts',
    'fonts.0.family',
    'fonts.0.weights',
    'assets',
    'assets.a1.type',
    'assets.a1.mime',
    'assets.a1.data',
    'assets.a1.w',
    'assets.a1.h',
    'tokens',
    'tokens.0.name',
    'tokens.0.value',
    'tokens.0.kind',
    'root',
    'root.id',
    'root.name',
    'root.type',
    'root.x',
    'root.y',
    'root.w',
    'root.h',
    'root.layout.mode',
    'root.layout.gap',
    'root.layout.padding',
    'root.layout.align',
    'root.layout.justify',
    'root.layout.wrap',
    'root.sizing.w',
    'root.sizing.h',
    'root.children.0.fills.0.type',
    'root.children.0.fills.0.angle',
    'root.children.0.fills.0.stops',
    'root.children.0.strokes.color',
    'root.children.0.strokes.opacity',
    'root.children.0.strokes.weight',
    'root.children.0.strokes.align',
    'root.children.0.effects.0.x',
    'root.children.0.effects.0.blur',
    'root.children.0.effects.0.spread',
    'root.children.0.effects.0.color',
    'root.children.0.effects.2.radius',
    'root.children.0.children.0.text.content',
    'root.children.0.children.0.text.font',
    'root.children.0.children.0.text.font.family',
    'root.children.0.children.0.text.font.weight',
    'root.children.0.children.0.text.font.style',
    'root.children.0.children.0.text.font.size',
    'root.children.0.children.0.text.font.lineHeight',
    'root.children.0.children.0.text.font.letterSpacing',
    'root.children.0.children.0.text.color',
    'root.children.0.children.0.text.align',
    'root.children.0.children.0.text.decoration',
    'root.children.0.children.0.text.transform',
    'root.children.0.children.0.semantic.tag',
    'root.children.0.children.0.semantic.classes',
    'root.children.1.asset',
    'root.children.1.fills.0.asset',
    'root.children.1.fills.0.scale',
  ];

  it.each(required)('a missing %s names its own path', (path) => {
    const broken = drop(clone(validTree()), path);
    const result = validateTree(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((issue) => issue.path);
      expect(paths).toContain(path);
    }
  });

  it('keeps an unknown field on a node and does not fail', () => {
    const tree = clone(validTree()) as unknown as Record<string, unknown>;
    put(tree, 'root.children.0.futureField', { anything: [1, 2, 3] });
    put(tree, 'root.children.0.children.0.text.tracking', 'loose');
    put(tree, 'version2', 'ignored');

    const result = validateTree(tree);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const node = result.tree.root.children?.[0] as unknown as Record<string, unknown>;
      expect(node['futureField']).toEqual({ anything: [1, 2, 3] });
    }
  });

  it('an unknown node type is fatal, an unknown field is not', () => {
    const tree = put(clone(validTree()), 'root.children.0.type', 'canvas');
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.path)).toContain('root.children.0.type');
    }
  });

  it('a colour that is not #rrggbb names itself', () => {
    const tree = put(clone(validTree()), 'root.fills.0.color', 'rgb(255,255,255)');
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const issue = result.errors.find((entry) => entry.path === 'root.fills.0.color');
      expect(issue?.message).toMatch(/#rrggbb/);
    }
  });

  it('an opacity outside 0..1 names itself', () => {
    const tree = put(clone(validTree()), 'root.fills.0.opacity', 255);
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.path)).toContain('root.fills.0.opacity');
    }
  });

  it('a wrong version is fatal', () => {
    const result = validateTree(put(clone(validTree()), 'version', 2));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.path).toBe('version');
  });

  it('radius must be four numbers', () => {
    const tree = put(clone(validTree()), 'root.children.0.radius', [12, 12]);
    expect(validateTree(tree).ok).toBe(false);
  });

  it('reports every bad field at once, not just the first', () => {
    let tree = clone(validTree()) as unknown;
    tree = drop(tree, 'root.id');
    tree = drop(tree, 'source.title');
    tree = drop(tree, 'root.children.1.fills.0.scale');
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((issue) => issue.path);
      expect(paths).toEqual(
        expect.arrayContaining(['root.id', 'source.title', 'root.children.1.fills.0.scale']),
      );
    }
  });

  it('a text node with no text names its path', () => {
    const tree = drop(clone(validTree()), 'root.children.0.children.0.text');
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.path)).toContain(
        'root.children.0.children.0.text',
      );
    }
  });

  it('a vector node with no asset names its path', () => {
    const tree = drop(clone(validTree()), 'root.children.0.children.1.asset');
    const result = validateTree(tree);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.path)).toContain(
        'root.children.0.children.1.asset',
      );
    }
  });

  it('validateNode checks one node on its own', () => {
    const ok = validateNode(validTree().root.children?.[1]);
    expect(ok.ok).toBe(true);
    const bad = validateNode({ id: 'x', name: 'x', type: 'frame', x: 0, y: 0, w: 0 });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((issue) => issue.path)).toContain('h');
  });

  it('the schema parses back to the same shape the types describe', () => {
    const parsed = designTreeSchema.parse(validTree()) as unknown as DesignTree;
    expect(parsed.root.children?.[0]?.layout?.padding).toEqual([12, 16, 12, 16]);
    expect(parsed.assets['a1']?.mime).toBe('image/png');
  });
});
