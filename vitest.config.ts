import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const p = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@fit-to-figma/tree': p('./packages/tree/src/index.ts'),
      '@fit-to-figma/map': p('./packages/map/src/index.ts'),
      '@fit-to-figma/extract': p('./packages/extract/src/index.ts'),
    },
  },
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'plugin/test/**/*.test.ts',
      'cli/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
