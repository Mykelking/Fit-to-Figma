import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The script the CLI injects into the page.
 *
 * `@fit-to-figma/extract` is plain browser TypeScript, so it has to be bundled
 * into one classic script before a page can run it. A published CLI ships that
 * bundle beside itself; a checkout builds it on demand with esbuild, which is
 * already a dependency, so `npm test` needs no build step first.
 */

let cached: string | null = null;

export async function extractBundle(): Promise<string> {
  if (cached !== null) return cached;

  const prebuilt = new URL('./extract.bundle.js', import.meta.url);
  if (existsSync(fileURLToPath(prebuilt))) {
    cached = await readFile(prebuilt, 'utf8');
    return cached;
  }

  cached = await buildBundle();
  return cached;
}

/** Bundle the extractor for a browser. Exported so `npm run build` can too. */
export async function buildBundle(): Promise<string> {
  const { build } = await import('esbuild');
  const result = await build({
    entryPoints: [entryPoint()],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'silent',
  });

  const file = result.outputFiles?.[0];
  if (!file) throw new Error('the extractor bundle came back empty');
  return file.text;
}

/**
 * `src/global.ts` sits beside the package's own entry, so resolving the
 * package finds it whether this is a checkout, an install, or a test runner
 * that has its own idea of what a module is.
 */
function entryPoint(): string {
  const manifest = createRequire(import.meta.url).resolve(
    '@fit-to-figma/extract/package.json',
  );
  return fileURLToPath(new URL('./src/global.ts', pathToFileURL(manifest)));
}
