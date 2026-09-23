import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const FIXTURES = path.join(ROOT, 'fixtures');

export const FIXTURE_NAMES = [
  'phone-screen',
  'marketing-page',
  'dashboard',
  'edge-cases',
  'exact-cases',
] as const;

export type FixtureName = (typeof FIXTURE_NAMES)[number];

/** What each fixture is laid out at. */
export const VIEWPORTS: Record<FixtureName, { w: number; h: number }> = {
  'phone-screen': { w: 390, h: 844 },
  'marketing-page': { w: 1280, h: 900 },
  dashboard: { w: 1440, h: 900 },
  'edge-cases': { w: 1200, h: 900 },
  'exact-cases': { w: 390, h: 844 },
};

export const fixtureHtml = (n: FixtureName) => path.join(FIXTURES, `${n}.html`);
export const fixtureExpect = (n: FixtureName) => path.join(FIXTURES, `${n}.expect.json`);

/**
 * The other four engineers are writing in parallel. Everything here probes for
 * a part rather than assuming it; a suite whose part is missing is marked todo
 * with the reason, so `npm run e2e` stays readable while the tree fills in.
 */

function firstExisting(...ps: string[]): string | null {
  return ps.find((p) => existsSync(p)) ?? null;
}

/** The CLI entry point: `fit-to-figma capture <file> -o out.json`. */
export function findCliBin(): string | null {
  return firstExisting(
    path.join(ROOT, 'cli', 'dist', 'bin.js'),
    path.join(ROOT, 'cli', 'dist', 'cli.js'),
    path.join(ROOT, 'cli', 'dist', 'index.js'),
    path.join(ROOT, 'cli', 'src', 'bin.ts'),
    path.join(ROOT, 'cli', 'src', 'cli.ts'),
  );
}

/** The extractor's entry module, for the in-page path. */
export function findExtractEntry(): string | null {
  return firstExisting(
    path.join(ROOT, 'packages', 'extract', 'src', 'index.ts'),
    path.join(ROOT, 'packages', 'extract', 'dist', 'index.js'),
  );
}

/** The plugin's builder: reads a tree, makes layers. */
export function findPluginBuilder(): string | null {
  return firstExisting(
    path.join(ROOT, 'plugin', 'src', 'main', 'build.ts'),
    path.join(ROOT, 'plugin', 'src', 'main', 'builder.ts'),
    path.join(ROOT, 'plugin', 'src', 'main', 'index.ts'),
    path.join(ROOT, 'plugin', 'src', 'main.ts'),
  );
}

/** The plugin engineer's fake `figma` global, under plugin/test/. */
export function findFakeFigma(): string | null {
  const dir = path.join(ROOT, 'plugin', 'test');
  if (!existsSync(dir)) return null;
  const names = readdirSync(dir);
  const wanted = ['figma.ts', 'fake-figma.ts', 'figma-fake.ts', 'fake.ts', 'index.ts'];
  const hit = wanted.find((w) => names.includes(w));
  return hit ? path.join(dir, hit) : null;
}

export function missing(what: string, where: string): string {
  return `${what} is not on disk yet (looked for ${where}) - marked todo`;
}
