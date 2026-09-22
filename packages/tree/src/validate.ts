import { z } from 'zod';
import { designTreeSchema, nodeSchema } from './schema.js';
import type { DesignTree, Node } from './types.js';

/** One thing wrong, with the path that points straight at it. */
export interface TreeIssue {
  /** Dotted path into the JSON, e.g. 'root.children.0.fills.1.color'. */
  path: string;
  message: string;
  /** zod's issue code, e.g. 'invalid_type'. */
  code: string;
}

export type ValidateResult =
  | { ok: true; tree: DesignTree }
  | { ok: false; errors: TreeIssue[] };

export type ValidateNodeResult =
  | { ok: true; node: Node }
  | { ok: false; errors: TreeIssue[] };

/** '' at the top of the document reads better as something visible. */
export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return '(root)';
  return path.map((part) => String(part)).join('.');
}

export function toIssues(error: z.ZodError): TreeIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Check a parsed design tree, or the JSON text of one.
 *
 * Unknown fields pass: the plugin ignores what it does not understand. What
 * fails is a field the doc names being absent or the wrong shape, and each
 * failure names its own path.
 */
export function validateTree(json: unknown): ValidateResult {
  let value = json;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            path: '(root)',
            message: `not JSON: ${(error as Error).message}`,
            code: 'invalid_json',
          },
        ],
      };
    }
  }

  const result = designTreeSchema.safeParse(value);
  if (!result.success) return { ok: false, errors: toIssues(result.error) };

  const tree = result.data as unknown as DesignTree;
  const errors = checkNode(tree.root, 'root');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, tree };
}

/** The same check for one node on its own, for tests and for partial runs. */
export function validateNode(json: unknown): ValidateNodeResult {
  const result = nodeSchema.safeParse(json);
  if (!result.success) return { ok: false, errors: toIssues(result.error) };

  const node = result.data as unknown as Node;
  const errors = checkNode(node, '');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, node };
}

/**
 * What the shapes alone cannot say: which optional field a node's `type` makes
 * compulsory. An image or a vector is nothing without its asset, and a text
 * node is nothing without its text.
 */
function checkNode(node: Node, path: string): TreeIssue[] {
  const errors: TreeIssue[] = [];
  const at = (field: string): string => (path === '' ? field : `${path}.${field}`);

  if ((node.type === 'image' || node.type === 'vector') && node.asset === undefined) {
    errors.push({
      path: at('asset'),
      message: `a ${node.type} node needs an asset`,
      code: 'missing_asset',
    });
  }
  if (node.type === 'text' && node.text === undefined) {
    errors.push({
      path: at('text'),
      message: 'a text node needs text',
      code: 'missing_text',
    });
  }

  const children = node.children;
  if (children) {
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child) errors.push(...checkNode(child, at(`children.${i}`)));
    }
  }
  return errors;
}
