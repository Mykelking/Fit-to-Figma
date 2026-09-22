import type { ExtractOptions, ExtractResult } from './index.js';
import { extractWithReport } from './index.js';

/**
 * The entry the CLI injects.
 *
 * A page cannot import a module, so the bundle hangs one function off the
 * window and the CLI calls it through `page.evaluate`. The root defaults to
 * `<html>`, which is the whole page.
 */

export interface FitToFigmaGlobal {
  extract(options?: ExtractOptions & { rootSelector?: string }): Promise<ExtractResult>;
  version: string;
}

const api: FitToFigmaGlobal = {
  version: '0.1.0',
  async extract(options = {}) {
    const { rootSelector, ...rest } = options;
    const root = rootSelector
      ? document.querySelector(rootSelector)
      : (document.documentElement as Element | null);
    if (!root) throw new Error(`nothing matched ${rootSelector ?? 'the document'}`);
    return extractWithReport(root, rest);
  },
};

(globalThis as unknown as Record<string, unknown>).__fitToFigma = api;

export default api;
