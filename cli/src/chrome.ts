import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where Chrome is.
 *
 * `puppeteer-core` brings no browser with it, which is the point: the CLI uses
 * the Chrome that is already on the machine. `--chrome` wins, then the two
 * environment variables people already set, then the usual places. Edge and
 * Chromium count, because they are the same engine.
 */

const WINDOWS = [
  'Google\\Chrome\\Application\\chrome.exe',
  'Google\\Chrome Beta\\Application\\chrome.exe',
  'Google\\Chrome SxS\\Application\\chrome.exe',
  'Chromium\\Application\\chrome.exe',
  'Microsoft\\Edge\\Application\\msedge.exe',
];

const MAC = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const LINUX = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
];

export function findChrome(given?: string): string {
  if (given) {
    if (!existsSync(given)) throw new Error(`no browser at ${given}`);
    return given;
  }

  for (const name of ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH', 'CHROME']) {
    const fromEnv = process.env[name];
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
  }

  for (const candidate of candidates()) {
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(
    'no Chrome, Chromium or Edge found. Pass --chrome <path> or set CHROME_PATH.',
  );
}

function candidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter((root): root is string => Boolean(root));
    return roots.flatMap((root) => WINDOWS.map((tail) => join(root, tail)));
  }
  if (process.platform === 'darwin') return MAC;
  return LINUX;
}
