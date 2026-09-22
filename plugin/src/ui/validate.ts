import { validateTree } from '@fit-to-figma/tree';
import type { DesignTree } from '@fit-to-figma/tree';

export interface TreeProblem {
  path: string;
  message: string;
}

export type Checked = { ok: true; tree: DesignTree } | { ok: false; errors: TreeProblem[] };

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

function fromThrown(err: unknown): TreeProblem[] {
  const e = err as Record<string, unknown> | null;
  if (e && typeof e === 'object' && Array.isArray(e.issues)) return toProblems(e.issues);
  return [{ path: '', message: err instanceof Error ? err.message : String(err) }];
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
