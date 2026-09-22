// Two files out: dist/code.js for the main thread and dist/ui.html, one
// self-contained page, because Figma serves the UI as a string.
import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p) => resolve(here, 'src', p);
const out = (p) => resolve(here, 'dist', p);
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  logLevel: 'info',
  tsconfig: resolve(here, 'tsconfig.json'),
  minify: !watch,
};

const mainOptions = {
  ...shared,
  entryPoints: [src('main/index.ts')],
  outfile: out('code.js'),
};

const uiPlugin = {
  name: 'ui-html',
  setup(b) {
    b.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const js = result.outputFiles?.[0]?.text ?? '';
      const shell = await readFile(src('ui/index.html'), 'utf8');
      const marker = '<script>/* @inline-script */</script>';
      if (!shell.includes(marker)) throw new Error('ui/index.html lost its script marker');
      // Replacer function: a plain string would expand $& and friends inside the bundle.
      const page = shell.replace(marker, () => '<script>\n' + js + '\n</script>');
      const closes = (s) => s.split('</script>').length - 1;
      if (closes(page) !== closes(shell) || page.includes(marker)) {
        throw new Error('ui.html script inlining broke: the bundle closed the script tag early');
      }
      await mkdir(out('.'), { recursive: true });
      await writeFile(out('ui.html'), page, 'utf8');
      console.log('  dist/ui.html  ' + Math.round(page.length / 1024) + 'kb');
    });
  },
};

const uiOptions = {
  ...shared,
  entryPoints: [src('ui/index.ts')],
  write: false,
  outfile: out('ui.js'),
  plugins: [uiPlugin],
};

await mkdir(out('.'), { recursive: true });

if (watch) {
  const a = await context(mainOptions);
  const b = await context(uiOptions);
  await Promise.all([a.watch(), b.watch()]);
  console.log('watching');
} else {
  await Promise.all([build(mainOptions), build(uiOptions)]);
}
