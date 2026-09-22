import { defineConfig } from 'vitest/config';

// The end to end suite: real Chrome, the real CLI, the plugin's fake figma.
// Kept out of `npm test` because it needs a browser on the machine.
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 600_000,
    // Timings in perf.test.ts are only meaningful when nothing else is running.
    fileParallelism: false,
    reporters: ['default'],
  },
});
