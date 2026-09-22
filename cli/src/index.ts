import type { Warning } from '@fit-to-figma/extract';
import { formatWarning } from '@fit-to-figma/extract';
import { validateTree } from '@fit-to-figma/tree';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { capture } from './capture.js';

export { capture, assetBytesOf } from './capture.js';
export type { CaptureOptions, CaptureResult } from './capture.js';
export { buildBundle, extractBundle } from './bundle.js';
export { findChrome } from './chrome.js';

/**
 * `fit-to-figma`.
 *
 * Two things: capture a page into a design tree, and check that a design tree
 * on disk is one. Everything the run could not do faithfully is printed, so a
 * page that came out wrong can be reported with the tree rather than the page.
 */

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

const USAGE = `fit-to-figma - turn a web page into a Fit to Figma design tree

  fit-to-figma capture <url|file.html> [options]
  fit-to-figma validate <tree.json>

Options for capture:
  -o, --out <file>        where to write the tree      (default: <name>.tree.json)
      --viewport <WxH>    the size to lay the page out (default: 390x844)
      --wait <ms|sel>     wait this long, or for this selector, before reading
      --full-page         grow the viewport to the whole document first
      --root <selector>   extract this element instead of the whole document
      --chrome <path>     the browser to drive        (default: the one installed)
      --include-hidden    keep what the page hid
      --max-depth <n>     stop walking this deep
      --asset-budget <n>  how many bytes of images and vectors to inline
      --timeout <ms>      how long to give the page to load
`;

export async function run(argv: string[], io: Io = consoleIo()): Promise<number> {
  const [first, ...rest] = argv;

  if (!first || first === '-h' || first === '--help' || first === 'help') {
    io.out(USAGE);
    return first ? 0 : 1;
  }

  if (first === 'validate') return runValidate(rest, io);
  // `capture` is the default: `fit-to-figma <url>` is the short way to say it.
  return runCapture(first === 'capture' ? rest : argv, io);
}

async function runCapture(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parseCapture>;
  try {
    parsed = parseCapture(argv);
  } catch (error) {
    io.err(`fit-to-figma: ${(error as Error).message}`);
    return 2;
  }

  const { target, out, ...options } = parsed;

  let result;
  try {
    result = await capture({ target, ...options });
  } catch (error) {
    io.err(`fit-to-figma: ${(error as Error).message}`);
    return 1;
  }

  const file = resolve(out ?? defaultOut(target));
  await writeFile(file, `${JSON.stringify(result.tree, null, 2)}\n`, 'utf8');

  io.out(summary(file, result.nodes, result.assetBytes, result.fonts, result.warnings));
  for (const warning of result.warnings) io.out(`  ${formatWarning(warning)}`);
  return 0;
}

export function summary(
  file: string,
  nodes: number,
  assetBytes: number,
  fonts: string[],
  warnings: Warning[],
): string {
  const parts = [
    `${basename(file)}`,
    `${nodes} nodes`,
    `${bytes(assetBytes)} of assets`,
    `fonts: ${fonts.length > 0 ? fonts.join(', ') : 'none'}`,
    `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`,
  ];
  return parts.join(' · ');
}

async function runValidate(argv: string[], io: Io): Promise<number> {
  const file = argv[0];
  if (!file) {
    io.err('fit-to-figma: validate needs a file');
    return 2;
  }

  let text: string;
  try {
    text = await readFile(resolve(file), 'utf8');
  } catch (error) {
    io.err(`fit-to-figma: ${(error as Error).message}`);
    return 1;
  }

  const checked = validateTree(text);
  if (!checked.ok) {
    io.err(`${basename(file)}: not a design tree, ${checked.errors.length} problems`);
    for (const issue of checked.errors.slice(0, 40)) {
      io.err(`  ${issue.path}: ${issue.message}`);
    }
    return 1;
  }

  const tree = checked.tree;
  io.out(
    [
      `${basename(file)}: a design tree, version ${tree.version}`,
      `${Object.keys(tree.assets).length} assets`,
      `${tree.tokens.length} tokens`,
      `fonts: ${tree.fonts.map((font) => font.family).join(', ') || 'none'}`,
    ].join(' · '),
  );
  return 0;
}

// ------------------------------------------------------------------- args

interface CaptureArgs {
  target: string;
  out?: string;
  viewport?: { w: number; h: number };
  wait?: string;
  fullPage?: boolean;
  chrome?: string;
  rootSelector?: string;
  includeHidden?: boolean;
  maxDepth?: number;
  assetBudgetBytes?: number;
  timeout?: number;
}

export function parseCapture(argv: string[]): CaptureArgs {
  const args: Partial<CaptureArgs> = {};
  let target: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };

    switch (arg) {
      case '-o':
      case '--out':
        args.out = value();
        break;
      case '--viewport':
        args.viewport = parseViewport(value());
        break;
      case '--wait':
        args.wait = value();
        break;
      case '--full-page':
        args.fullPage = true;
        break;
      case '--root':
        args.rootSelector = value();
        break;
      case '--chrome':
        args.chrome = value();
        break;
      case '--include-hidden':
        args.includeHidden = true;
        break;
      case '--max-depth':
        args.maxDepth = number(value(), '--max-depth');
        break;
      case '--asset-budget':
        args.assetBudgetBytes = number(value(), '--asset-budget');
        break;
      case '--timeout':
        args.timeout = number(value(), '--timeout');
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
        if (target !== undefined) throw new Error('capture takes one page');
        target = arg;
    }
  }

  if (target === undefined) throw new Error('capture needs a URL or an HTML file');
  return { ...args, target };
}

export function parseViewport(value: string): { w: number; h: number } {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error(`--viewport wants WxH, e.g. 390x844, not ${value}`);
  return { w: Number(match[1]), h: Number(match[2]) };
}

function number(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} wants a number, not ${value}`);
  return parsed;
}

/** `https://example.com/pricing` becomes `pricing.tree.json`. */
function defaultOut(target: string): string {
  let name = target;
  try {
    if (/^https?:\/\//i.test(target)) {
      const url = new URL(target);
      const last = url.pathname.split('/').filter(Boolean).pop();
      name = last ?? url.hostname;
    }
  } catch {
    // keep the target as it came
  }
  const base = basename(name).replace(/\.[^.]*$/, '').replace(/[^a-z0-9._-]+/gi, '-');
  return `${base || 'page'}.tree.json`;
}

function bytes(total: number): string {
  if (total < 1024) return `${total} B`;
  if (total < 1024 * 1024) return `${(total / 1024).toFixed(1)} kB`;
  return `${(total / (1024 * 1024)).toFixed(1)} MB`;
}

function consoleIo(): Io {
  return {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  };
}
