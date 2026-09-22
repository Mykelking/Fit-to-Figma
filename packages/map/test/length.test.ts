import { describe, expect, it } from 'vitest';
import { normalizeAngle, splitSpaces, splitTop, toDegrees, toPx, toPxOr } from '../src/index.js';

describe('toPx', () => {
  it('reads absolute lengths', () => {
    expect(toPx('12px')).toBe(12);
    expect(toPx('  -4.5px ')).toBe(-4.5);
    expect(toPx('0')).toBe(0);
    expect(toPx('12pt')).toBe(16);
    expect(toPx('1in')).toBe(96);
  });

  it('reads em against the element and rem against the root', () => {
    expect(toPx('1.5em', { font: 20 })).toBe(30);
    expect(toPx('2rem', { root: 10 })).toBe(20);
    expect(toPx('2rem')).toBe(32);
    // em with no font size falls back to the root size.
    expect(toPx('2em', { root: 10 })).toBe(20);
  });

  it('reads a percentage of the parent, and nothing without one', () => {
    expect(toPx('50%', { parent: 320 })).toBe(160);
    expect(toPx('50%')).toBeNull();
  });

  it('reads viewport units', () => {
    const viewport = { w: 390, h: 844 };
    expect(toPx('100vw', { viewport })).toBe(390);
    expect(toPx('50vh', { viewport })).toBe(422);
    expect(toPx('10vmin', { viewport })).toBe(39);
    expect(toPx('10vmax', { viewport })).toBe(84.4);
    expect(toPx('100vw')).toBeNull();
  });

  it('returns null for what is not a length', () => {
    expect(toPx('auto')).toBeNull();
    expect(toPx('normal')).toBeNull();
    expect(toPx('')).toBeNull();
    expect(toPx('red')).toBeNull();
    expect(toPx('calc(100% - 8px)')).toBeNull();
  });

  it('toPxOr falls back', () => {
    expect(toPxOr('auto', 7)).toBe(7);
    expect(toPxOr('3px', 7)).toBe(3);
  });
});

describe('toDegrees', () => {
  it('reads every angle unit', () => {
    expect(toDegrees('90deg')).toBe(90);
    expect(toDegrees('90')).toBe(90);
    expect(toDegrees('0.25turn')).toBe(90);
    expect(toDegrees('100grad')).toBe(90);
    expect(toDegrees('3.14159rad')).toBeCloseTo(180, 2);
    expect(toDegrees('red')).toBeNull();
  });

  it('normalizeAngle lands in 0..360', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
  });
});

describe('splitting', () => {
  it('splitTop respects brackets', () => {
    expect(splitTop('0 2px 8px rgba(0,0,0,.15), inset 0 1px 0 #fff')).toEqual([
      '0 2px 8px rgba(0,0,0,.15)',
      'inset 0 1px 0 #fff',
    ]);
  });

  it('splitTop respects quotes', () => {
    expect(splitTop('"Plus Jakarta Sans", system-ui')).toEqual([
      '"Plus Jakarta Sans"',
      'system-ui',
    ]);
  });

  it('splitSpaces keeps a function whole', () => {
    expect(splitSpaces('0 2px 8px 0 rgba(0, 0, 0, .15)')).toEqual([
      '0',
      '2px',
      '8px',
      '0',
      'rgba(0, 0, 0, .15)',
    ]);
  });
});
