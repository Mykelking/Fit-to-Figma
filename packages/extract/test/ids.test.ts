import { describe, expect, it } from 'vitest';
import { Ids, hashString } from '../src/ids.js';
import { Warnings, formatWarning } from '../src/warnings.js';

/**
 * Ids and warnings have no DOM in them, so they are checked on their own.
 */

describe('ids', () => {
  it('hashes the same string the same way, always', () => {
    expect(hashString('div:0/p:1')).toBe(hashString('div:0/p:1'));
    expect(hashString('div:0/p:1')).not.toBe(hashString('div:0/p:2'));
    expect(hashString('')).toMatch(/^[0-9a-z]{7,}$/);
  });

  it('gives one id per path, and never the same id twice', () => {
    const ids = new Ids();
    const first = ids.take('div:0');
    const second = ids.take('div:0');
    expect(first).not.toBe(second);
    expect(new Ids().take('div:0')).toBe(first);
  });

  it('gives the same run of ids for the same run of paths', () => {
    const paths = ['', 'div:0', 'div:0/p:0', 'div:0/p:0#t0', 'div:0/p:1'];
    const once = new Ids();
    const twice = new Ids();
    expect(paths.map((path) => once.take(path))).toEqual(paths.map((path) => twice.take(path)));
  });
});

describe('warnings', () => {
  it('folds a repeat into a count and keeps the first order', () => {
    const warnings = new Warnings();
    warnings.add('icon-font', 'an icon font', { detail: 'Iconsax' });
    warnings.add('asset-fetch-failed', 'not reachable', { detail: 'a.png' });
    warnings.add('icon-font', 'an icon font', { detail: 'Iconsax' });

    const list = warnings.list();
    expect(list.map((warning) => warning.code)).toEqual(['icon-font', 'asset-fetch-failed']);
    expect(list[0]?.count).toBe(2);
    expect(formatWarning(list[0]!)).toBe('icon-font: an icon font (Iconsax) x2');
  });

  it('tells the caller as each new one is raised', () => {
    const seen: string[] = [];
    const warnings = new Warnings((warning) => seen.push(warning.code));
    warnings.add('iframe-skipped', 'an iframe');
    warnings.add('iframe-skipped', 'an iframe');
    expect(seen).toEqual(['iframe-skipped']);
  });
});
