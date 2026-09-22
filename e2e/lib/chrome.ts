import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Find a Chrome (or Chromium, or Edge) to drive. `CHROME` wins over everything.
 * Returns null when there is none, so a suite can skip with a clear message
 * rather than fail on a machine that simply has no browser.
 */
export function findChrome(): string | null {
  const fromEnv = process.env['CHROME'];
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;

  const home = process.env['LOCALAPPDATA'] ?? '';
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';

  const candidates: string[] =
    process.platform === 'win32'
      ? [
          path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(home, 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(pf, 'Chromium\\Application\\chrome.exe'),
          path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe'),
          path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        ]
      : process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
            '/usr/bin/microsoft-edge',
          ];

  return candidates.find((p) => existsSync(p)) ?? null;
}

export const NO_CHROME =
  'No Chrome found. Install Google Chrome, or point CHROME at an executable: CHROME="/path/to/chrome" npm run e2e';
