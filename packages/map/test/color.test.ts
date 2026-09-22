import { describe, expect, it } from 'vitest';
import { BLACK, isColor, parseColor, parseColorOr, toHex } from '../src/index.js';

describe('parseColor', () => {
  it('reads hex in every length', () => {
    expect(parseColor('#fff')).toEqual({ color: '#ffffff', opacity: 1 });
    expect(parseColor('#9C4679')).toEqual({ color: '#9c4679', opacity: 1 });
    expect(parseColor('#9c467966')).toEqual({ color: '#9c4679', opacity: 0.4 });
    expect(parseColor('#f008')).toEqual({ color: '#ff0000', opacity: 0.533 });
  });

  it('reads the legacy rgb forms', () => {
    expect(parseColor('rgb(255, 255, 255)')).toEqual({ color: '#ffffff', opacity: 1 });
    expect(parseColor('rgba(156, 70, 121, 0.4)')).toEqual({ color: '#9c4679', opacity: 0.4 });
    expect(parseColor('rgba(0,0,0,.15)')).toEqual({ color: '#000000', opacity: 0.15 });
    expect(parseColor('rgb(100%, 0%, 0%)')).toEqual({ color: '#ff0000', opacity: 1 });
  });

  it('reads the modern space separated forms', () => {
    expect(parseColor('rgb(156 70 121)')).toEqual({ color: '#9c4679', opacity: 1 });
    expect(parseColor('rgb(156 70 121 / 40%)')).toEqual({ color: '#9c4679', opacity: 0.4 });
    expect(parseColor('rgb(0 0 0 / .15)')).toEqual({ color: '#000000', opacity: 0.15 });
  });

  it('reads hsl in both syntaxes', () => {
    expect(parseColor('hsl(0, 0%, 100%)')).toEqual({ color: '#ffffff', opacity: 1 });
    expect(parseColor('hsl(320 40% 45% / .5)')).toEqual({ color: '#a14582', opacity: 0.5 });
    expect(parseColor('hsla(120, 100%, 50%, 0.25)')).toEqual({
      color: '#00ff00',
      opacity: 0.25,
    });
    expect(parseColor('hsl(0.5turn 100% 50%)')).toEqual({ color: '#00ffff', opacity: 1 });
  });

  it('reads named colours and the two keywords', () => {
    expect(parseColor('rebeccapurple')).toEqual({ color: '#663399', opacity: 1 });
    expect(parseColor('  Tomato ')).toEqual({ color: '#ff6347', opacity: 1 });
    expect(parseColor('transparent')).toEqual({ color: '#000000', opacity: 0 });
  });

  it('resolves currentcolor from the context, and black without one', () => {
    expect(parseColor('currentcolor', { currentColor: '#9c4679' })).toEqual({
      color: '#9c4679',
      opacity: 1,
    });
    expect(parseColor('currentColor')).toEqual(BLACK);
    expect(parseColor('currentcolor', { currentColor: 'currentcolor' })).toEqual(BLACK);
  });

  it('reads hwb and color(srgb …)', () => {
    expect(parseColor('hwb(0 0% 0%)')).toEqual({ color: '#ff0000', opacity: 1 });
    expect(parseColor('color(srgb 1 0 0 / 0.5)')).toEqual({ color: '#ff0000', opacity: 0.5 });
    expect(parseColor('color(display-p3 1 0 0)')).toBeNull();
  });

  it('returns null for what is not a colour', () => {
    expect(parseColor('')).toBeNull();
    expect(parseColor('12px')).toBeNull();
    expect(parseColor('inherit')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(a, b, c)')).toBeNull();
    expect(parseColor('linear-gradient(red, blue)')).toBeNull();
  });

  it('clamps what a page can still write', () => {
    expect(parseColor('rgb(300, -20, 0)')).toEqual({ color: '#ff0000', opacity: 1 });
    expect(parseColor('rgba(0,0,0,5)')).toEqual({ color: '#000000', opacity: 1 });
  });

  it('parseColorOr and isColor', () => {
    expect(parseColorOr('nonsense', BLACK)).toEqual(BLACK);
    expect(parseColorOr('#fff', BLACK)).toEqual({ color: '#ffffff', opacity: 1 });
    expect(isColor('red')).toBe(true);
    expect(isColor('2px')).toBe(false);
  });

  it('toHex rounds and clamps', () => {
    expect(toHex(0, 0, 0)).toBe('#000000');
    expect(toHex(255.4, -3, 128.5)).toBe('#ff0081');
  });
});
