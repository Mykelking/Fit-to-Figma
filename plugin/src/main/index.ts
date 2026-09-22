import type { MainToUi, UiToMain } from '../shared/messages.js';
import { build } from './build.js';

figma.showUI(__html__, { width: 460, height: 620, themeColors: true });

function post(msg: MainToUi): void {
  figma.ui.postMessage(msg);
}

let running = false;

figma.ui.onmessage = async (raw: unknown): Promise<void> => {
  const msg = raw as UiToMain;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'close') {
    figma.closePlugin();
    return;
  }

  if (msg.type === 'resize') {
    const height = Math.max(320, Math.min(900, Math.round(msg.height)));
    figma.ui.resize(460, height);
    return;
  }

  if (msg.type === 'build') {
    if (running) return;
    running = true;
    try {
      // Files of one drop share a collection, so its name cannot follow a source.
      const many = msg.batch !== undefined && msg.batch.total > 1;
      const options = many ? { ...msg.options, collection: 'Fit to Figma' } : msg.options;
      const report = await build(msg.trees, options, {
        onProgress: (done, total, label) => post({ type: 'progress', done, total, label }),
      });
      post({ type: 'done', report, batch: msg.batch });
    } catch (err) {
      post({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  }
};
