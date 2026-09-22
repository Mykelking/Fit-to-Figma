import { validateTree } from '@fit-to-figma/tree';
import type { DesignTree } from '@fit-to-figma/tree';

export interface TreeProblem {
  path: string;
  message: string;
}

export type Checked = { ok: true; tree: DesignTree } | { ok: false; errors: TreeProblem[] };

export type CheckedTrees = { ok: true; trees: DesignTree[] } | { ok: false; errors: TreeProblem[] };

/**
 * A dropped file holds one tree or an array of whole trees. The text is parsed
 * once here, because a file can be tens of megabytes.
 */
export function checkTrees(text: string): CheckedTrees {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    return { ok: false, errors: [{ path: '(root)', message: 'not JSON: ' + message(err) }] };
  }

  if (!Array.isArray(parsed)) {
    const checked = checkTree(parsed);
    return checked.ok ? { ok: true, trees: [checked.tree] } : { ok: false, errors: checked.errors };
  }
  if (parsed.length === 0) return { ok: false, errors: [{ path: '(root)', message: 'the file holds no trees' }] };

  const trees: DesignTree[] = [];
  const errors: TreeProblem[] = [];
  for (let i = 0; i < parsed.length; i += 1) {
    const checked = checkTree(parsed[i]);
    if (checked.ok) {
      trees.push(checked.tree);
      continue;
    }
    // Each error keeps its own path, under the tree it came from.
    for (const e of checked.errors) {
      errors.push({ path: '[' + i + ']' + (e.path === '' ? '' : '.' + e.path), message: e.message });
    }
  }
  // One bad tree loads none of them: a half built page is worse than a retry.
  return errors.length > 0 ? { ok: false, errors } : { ok: true, trees };
}

/**
 * The one place that touches validateTree's return shape, so reconciling with
 * the tree package when it lands is a change to this file and nothing else.
 * It reads {ok, tree, errors}, a zod-style {success, error.issues}, a thrown
 * error, or the tree itself.
 */
export function checkTree(input: unknown): Checked {
  let result: unknown;
  try {
    result = (validateTree as (value: unknown) => unknown)(input);
  } catch (err) {
    return { ok: false, errors: fromThrown(err) };
  }

  const r = result as Record<string, unknown> | null;
  if (r && typeof r === 'object') {
    if (r.ok === true) return { ok: true, tree: (r.tree ?? r.value ?? input) as DesignTree };
    if (r.ok === false) return { ok: false, errors: toProblems(r.errors ?? r.issues) };
    if (r.success === true) return { ok: true, tree: (r.data ?? input) as DesignTree };
    if (r.success === false) {
      const error = r.error as Record<string, unknown> | undefined;
      return { ok: false, errors: toProblems(error?.issues ?? r.issues ?? r.errors) };
    }
    if ('root' in r) return { ok: true, tree: r as unknown as DesignTree };
  }
  return { ok: true, tree: input as DesignTree };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fromThrown(err: unknown): TreeProblem[] {
  const e = err as Record<string, unknown> | null;
  if (e && typeof e === 'object' && Array.isArray(e.issues)) return toProblems(e.issues);
  return [{ path: '', message: message(err) }];
}

function toProblems(raw: unknown): TreeProblem[] {
  if (!Array.isArray(raw)) return [{ path: '', message: 'the tree did not validate' }];
  const out: TreeProblem[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      out.push({ path: '', message: item });
      continue;
    }
    const i = item as Record<string, unknown>;
    const path = Array.isArray(i.path) ? i.path.join('.') : typeof i.path === 'string' ? i.path : '';
    const message = typeof i.message === 'string' ? i.message : JSON.stringify(item);
    out.push({ path, message });
  }
  return out.length > 0 ? out : [{ path: '', message: 'the tree did not validate' }];
}
