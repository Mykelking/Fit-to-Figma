import { describe, expect, it } from 'vitest';
import { isSquare, mapRadius } from '../src/index.js';

const box = { w: 200, h: 100 };

describe('mapRadius', () => {
  it('reads the one to four value shorthand', () => {
    expect(mapRadius('8px', box)).toEqual([8, 8, 8, 8]);
    expect(mapRadius('8px 4px', box)).toEqual([8, 4, 8, 4]);
    expect(mapRadius('8px 4px 2px', box)).toEqual([8, 4, 2, 4]);
    expect(mapRadius('12px 16px 12px 16px', box)).toEqual([12, 16, 12, 16]);
  });

  it('takes the horizontal half of the elliptical form', () => {
    expect(mapRadius('8px / 16px', box)).toEqual([8, 8, 8, 8]);
    expect(mapRadius('8px 4px / 16px 32px', box)).toEqual([8, 4, 8, 4]);
  });

  it('reads a percentage of the width', () => {
    expect(mapRadius('10%', box)).toEqual([20, 20, 20, 20]);
    expect(mapRadius('50%', box)).toEqual([50, 50, 50, 50]);
  });

  it('clamps to half the shorter side', () => {
    expect(mapRadius('999px', box)).toEqual([50, 50, 50, 50]);
    expect(mapRadius('9999px', { w: 100, h: 40 })).toEqual([20, 20, 20, 20]);
    expect(mapRadius('40px 4px', { w: 100, h: 40 })).toEqual([20, 4, 20, 4]);
  });

  it('never goes negative', () => {
    expect(mapRadius('-8px', box)).toEqual([0, 0, 0, 0]);
  });

  it('reads em and rem', () => {
    expect(mapRadius('1rem', box)).toEqual([16, 16, 16, 16]);
    expect(mapRadius('0.5em', box, { font: 24 })).toEqual([12, 12, 12, 12]);
  });

  it('gives nothing for nothing', () => {
    expect(mapRadius('', box)).toEqual([0, 0, 0, 0]);
    expect(mapRadius('none', box)).toEqual([0, 0, 0, 0]);
    expect(mapRadius('0px', box)).toEqual([0, 0, 0, 0]);
  });

  it('a zero sized box has no room to round', () => {
    expect(mapRadius('12px', { w: 0, h: 0 })).toEqual([0, 0, 0, 0]);
  });

  it('isSquare', () => {
    expect(isSquare([0, 0, 0, 0])).toBe(true);
    expect(isSquare([0, 0, 1, 0])).toBe(false);
  });
});
