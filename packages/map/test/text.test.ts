import { describe, expect, it } from 'vitest';
import {
  mapFont,
  mapFontFamily,
  mapFontStyle,
  mapFontWeight,
  mapLetterSpacing,
  mapLineHeight,
  mapTextAlign,
  mapTextDecoration,
  mapTextStyle,
  mapTextTransform,
} from '../src/index.js';

describe('mapFontFamily', () => {
  it('takes the first family and keeps the rest', () => {
    expect(mapFontFamily('"Plus Jakarta Sans", system-ui, sans-serif')).toEqual({
      family: 'Plus Jakarta Sans',
      fallbacks: ['system-ui', 'sans-serif'],
    });
  });

  it('strips either kind of quote', () => {
    expect(mapFontFamily("'SF Pro Text', -apple-system").family).toBe('SF Pro Text');
    expect(mapFontFamily('Inter').fallbacks).toEqual([]);
  });

  it('falls back to Inter when there is nothing', () => {
    expect(mapFontFamily('').family).toBe('Inter');
  });
});

describe('mapFontWeight', () => {
  it('reads the names', () => {
    expect(mapFontWeight('normal')).toBe(400);
    expect(mapFontWeight('bold')).toBe(700);
    expect(mapFontWeight('lighter')).toBe(300);
    expect(mapFontWeight('bolder')).toBe(700);
    expect(mapFontWeight('semibold')).toBe(600);
    expect(mapFontWeight('extra bold')).toBe(800);
    expect(mapFontWeight('Extra-Light')).toBe(200);
  });

  it('reads the numbers and clamps them', () => {
    expect(mapFontWeight('500')).toBe(500);
    expect(mapFontWeight('450.5')).toBe(451);
    expect(mapFontWeight('2000')).toBe(1000);
    expect(mapFontWeight('')).toBe(400);
    expect(mapFontWeight('nonsense')).toBe(400);
  });
});

describe('mapFontStyle', () => {
  it('only italic and oblique lean', () => {
    expect(mapFontStyle('italic')).toBe('italic');
    expect(mapFontStyle('oblique 10deg')).toBe('italic');
    expect(mapFontStyle('normal')).toBe('normal');
    expect(mapFontStyle('')).toBe('normal');
  });
});

describe('mapLineHeight', () => {
  it('normal is 1.2 of the font size', () => {
    expect(mapLineHeight('normal', 16)).toBe(19.2);
    expect(mapLineHeight('', 20)).toBe(24);
  });

  it('a bare number is a multiple', () => {
    expect(mapLineHeight('1.5', 16)).toBe(24);
    expect(mapLineHeight('1', 14)).toBe(14);
  });

  it('a length is itself', () => {
    expect(mapLineHeight('24px', 16)).toBe(24);
    expect(mapLineHeight('1.5em', 16)).toBe(24);
    expect(mapLineHeight('150%', 16)).toBe(24);
  });
});

describe('mapLetterSpacing', () => {
  it('normal is nothing', () => {
    expect(mapLetterSpacing('normal', 16)).toBe(0);
    expect(mapLetterSpacing('', 16)).toBe(0);
  });

  it('em is of the font size', () => {
    expect(mapLetterSpacing('0.05em', 16)).toBe(0.8);
    expect(mapLetterSpacing('-0.02em', 20)).toBe(-0.4);
  });

  it('px is itself', () => {
    expect(mapLetterSpacing('1.5px', 16)).toBe(1.5);
  });

  it('a bare number is not a length in CSS, so it is nothing', () => {
    expect(mapLetterSpacing('2', 16)).toBe(0);
  });
});

describe('mapTextTransform', () => {
  it('only upper and lower have a counterpart', () => {
    expect(mapTextTransform('uppercase')).toBe('upper');
    expect(mapTextTransform('lowercase')).toBe('lower');
    expect(mapTextTransform('capitalize')).toBe('none');
    expect(mapTextTransform('none')).toBe('none');
  });
});

describe('mapTextDecoration', () => {
  it('reads the shorthand a browser gives back', () => {
    expect(mapTextDecoration('none solid rgb(0, 0, 0)')).toBe('none');
    expect(mapTextDecoration('underline solid rgb(156, 70, 121)')).toBe('underline');
    expect(mapTextDecoration('line-through solid rgb(0, 0, 0)')).toBe('strike');
    expect(mapTextDecoration('underline')).toBe('underline');
    expect(mapTextDecoration('')).toBe('none');
  });
});

describe('mapTextAlign', () => {
  it('reads the sides and the logical words', () => {
    expect(mapTextAlign('center')).toBe('center');
    expect(mapTextAlign('right')).toBe('right');
    expect(mapTextAlign('start')).toBe('left');
    expect(mapTextAlign('end')).toBe('right');
    expect(mapTextAlign('justify')).toBe('left');
    expect(mapTextAlign('')).toBe('left');
  });

  it('flips with the reading direction', () => {
    expect(mapTextAlign('start', 'rtl')).toBe('right');
    expect(mapTextAlign('end', 'rtl')).toBe('left');
    expect(mapTextAlign('left', 'rtl')).toBe('left');
  });
});

describe('mapFont and mapTextStyle', () => {
  const computed = {
    'font-family': '"Plus Jakarta Sans", system-ui, sans-serif',
    'font-size': '16px',
    'font-weight': '700',
    'font-style': 'normal',
    'line-height': '24px',
    'letter-spacing': '0.02em',
    color: 'rgba(156, 70, 121, 0.8)',
    'text-align': 'center',
    'text-decoration': 'underline solid rgb(156, 70, 121)',
    'text-transform': 'uppercase',
  };

  it('builds the font the tree wants', () => {
    expect(mapFont(computed)).toEqual({
      family: 'Plus Jakarta Sans',
      weight: 700,
      style: 'normal',
      size: 16,
      lineHeight: 24,
      letterSpacing: 0.32,
    });
  });

  it('builds the whole text style', () => {
    expect(mapTextStyle('Join', computed)).toEqual({
      content: 'Join',
      font: {
        family: 'Plus Jakarta Sans',
        weight: 700,
        style: 'normal',
        size: 16,
        lineHeight: 24,
        letterSpacing: 0.32,
      },
      color: '#9c4679',
      opacity: 0.8,
      align: 'center',
      decoration: 'underline',
      transform: 'upper',
    });
  });

  it('reads a rem font size against the root', () => {
    expect(mapFont({ 'font-size': '1.5rem' }, { root: 16 }).size).toBe(24);
  });

  it('takes sensible defaults from an empty style', () => {
    expect(mapTextStyle('', {})).toEqual({
      content: '',
      font: {
        family: 'Inter',
        weight: 400,
        style: 'normal',
        size: 16,
        lineHeight: 19.2,
        letterSpacing: 0,
      },
      color: '#000000',
      opacity: 1,
      align: 'left',
      decoration: 'none',
      transform: 'none',
    });
  });

  it('prefers text-decoration-line when the browser gave it', () => {
    expect(
      mapTextStyle('x', { 'text-decoration-line': 'line-through', 'text-decoration': 'none' })
        .decoration,
    ).toBe('strike');
  });
});
