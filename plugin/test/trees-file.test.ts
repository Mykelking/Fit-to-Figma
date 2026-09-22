import { describe, expect, it } from 'vitest';
import { checkTrees } from '../src/ui/validate.js';
import { node, tree } from './helpers.js';

function sample(title: string) {
  return tree(node({ type: 'frame', id: 'root-' + title, name: 'body' }), {
    source: { kind: 'file', ref: title + '.html', title, capturedAt: '', viewport: { w: 390, h: 844 } },
  });
}

describe('a dropped file of trees', () => {
  it('reads one tree from an object', () => {
    const checked = checkTrees(JSON.stringify(sample('one')));
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.trees).toHaveLength(1);
  });

  it('reads every tree from an array, in order', () => {
    const checked = checkTrees(JSON.stringify([sample('a'), sample('b'), sample('c')]));
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.trees.map((t) => t.source.title)).toEqual(['a', 'b', 'c']);
  });

  it('keeps page on the way through', () => {
    const one = sample('a') as unknown as Record<string, unknown>;
    one['page'] = 'Screens';
    const checked = checkTrees(JSON.stringify([one]));
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.trees[0]?.page).toBe('Screens');
  });

  it('an empty page name is a problem, under its own index', () => {
    const one = sample('a') as unknown as Record<string, unknown>;
    one['page'] = '';
    const checked = checkTrees(JSON.stringify([sample('ok'), one]));
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors[0]?.path).toBe('[1].page');
  });

  it('keeps place on the way through', () => {
    const one = sample('a') as unknown as Record<string, unknown>;
    one['place'] = { x: 40, y: -10 };
    const checked = checkTrees(JSON.stringify([one]));
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.trees[0]?.place).toEqual({ x: 40, y: -10 });
  });

  it('one bad tree out of three loads none of them and names its index', () => {
    const bad = sample('b') as unknown as Record<string, unknown>;
    delete bad['tokens'];
    const checked = checkTrees(JSON.stringify([sample('a'), bad, sample('c')]));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.errors).toHaveLength(1);
      expect(checked.errors[0]?.path).toBe('[1].tokens');
    }
  });

  it('reports each bad tree under its own index', () => {
    const first = sample('a') as unknown as Record<string, unknown>;
    delete first['fonts'];
    const third = sample('c') as unknown as Record<string, unknown>;
    delete third['root'];
    const checked = checkTrees(JSON.stringify([first, sample('b'), third]));
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.errors.map((e) => e.path)).toEqual(['[0].fonts', '[2].root']);
    }
  });

  it('fails on text that is not JSON', () => {
    const checked = checkTrees('{ nope');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.errors[0]?.message).toContain('not JSON');
  });

  it('fails on JSON that is neither a tree nor an array of them', () => {
    expect(checkTrees('42').ok).toBe(false);
    expect(checkTrees('{"version":1}').ok).toBe(false);
    expect(checkTrees('[]').ok).toBe(false);
    expect(checkTrees('[1, 2]').ok).toBe(false);
  });
});
