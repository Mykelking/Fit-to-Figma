import { describe, expect, it } from 'vitest';
import {
  mapBackdropFilter,
  mapBoxShadow,
  mapEffects,
  mapFilter,
  mapTextShadow,
} from '../src/index.js';

describe('mapBoxShadow', () => {
  it('reads the ugly two shadow list from the brief', () => {
    expect(mapBoxShadow('0 2px 8px 0 rgba(0,0,0,.15), inset 0 1px 0 #fff')).toEqual([
      { type: 'shadow', x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.15 },
      { type: 'inner-shadow', x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff', opacity: 1 },
    ]);
  });

  it('reads a shadow with no blur and no colour', () => {
    expect(mapBoxShadow('2px 4px')).toEqual([
      { type: 'shadow', x: 2, y: 4, blur: 0, spread: 0, color: '#000000', opacity: 1 },
    ]);
  });

  it('reads a colour that comes first', () => {
    expect(mapBoxShadow('rgba(156, 70, 121, 0.4) 0 4px 12px')).toEqual([
      { type: 'shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#9c4679', opacity: 0.4 },
    ]);
  });

  it('reads a negative offset and a negative spread', () => {
    expect(mapBoxShadow('-2px -4px 6px -1px #000')).toEqual([
      { type: 'shadow', x: -2, y: -4, blur: 6, spread: -1, color: '#000000', opacity: 1 },
    ]);
  });

  it('takes inset wherever it sits', () => {
    expect(mapBoxShadow('inset 0 1px 2px #fff')[0]?.type).toBe('inner-shadow');
    expect(mapBoxShadow('0 1px 2px #fff inset')[0]?.type).toBe('inner-shadow');
  });

  it('falls back to the element colour when the page named none', () => {
    expect(mapBoxShadow('0 2px 4px', { currentColor: '#9c4679' })[0]?.color).toBe('#9c4679');
  });

  it('reads em offsets against the font size', () => {
    expect(mapBoxShadow('0 0.5em 1em #000', { font: 16 })[0]).toMatchObject({
      y: 8,
      blur: 16,
    });
  });

  it('gives nothing for none, empty or nonsense', () => {
    expect(mapBoxShadow('none')).toEqual([]);
    expect(mapBoxShadow('')).toEqual([]);
    expect(mapBoxShadow('#fff')).toEqual([]);
  });

  it('never lets the blur go negative', () => {
    expect(mapBoxShadow('0 0 -4px #000')[0]?.blur).toBe(0);
  });
});

describe('mapTextShadow', () => {
  it('has no spread and never goes inner', () => {
    expect(mapTextShadow('1px 1px 2px rgba(0,0,0,.5)')).toEqual([
      { type: 'shadow', x: 1, y: 1, blur: 2, spread: 0, color: '#000000', opacity: 0.5 },
    ]);
    expect(mapTextShadow('inset 1px 1px 2px #000')[0]?.type).toBe('shadow');
  });

  it('reads a list', () => {
    expect(mapTextShadow('0 1px 0 #fff, 0 -1px 0 #000')).toHaveLength(2);
  });
});

describe('blur filters', () => {
  it('reads filter: blur()', () => {
    expect(mapFilter('blur(12px)')).toEqual([{ type: 'blur', radius: 12 }]);
    expect(mapFilter('blur(0.5rem)')).toEqual([{ type: 'blur', radius: 8 }]);
  });

  it('reads backdrop-filter: blur()', () => {
    expect(mapBackdropFilter('blur(20px)')).toEqual([{ type: 'backdrop-blur', radius: 20 }]);
  });

  it('ignores every other filter function', () => {
    expect(mapFilter('brightness(0.8) blur(4px) saturate(1.2)')).toEqual([
      { type: 'blur', radius: 4 },
    ]);
    expect(mapFilter('drop-shadow(0 1px 2px #000)')).toEqual([]);
    expect(mapFilter('none')).toEqual([]);
    expect(mapFilter('')).toEqual([]);
  });

  it('drops a blur of nothing', () => {
    expect(mapFilter('blur(0px)')).toEqual([]);
  });
});

describe('mapEffects', () => {
  it('puts everything on one element in paint order', () => {
    expect(
      mapEffects({
        boxShadow: '0 2px 8px rgba(0,0,0,.15)',
        filter: 'blur(4px)',
        backdropFilter: 'blur(20px)',
      }),
    ).toEqual([
      { type: 'shadow', x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.15 },
      { type: 'blur', radius: 4 },
      { type: 'backdrop-blur', radius: 20 },
    ]);
  });

  it('gives nothing for an element with nothing on it', () => {
    expect(mapEffects({})).toEqual([]);
  });
});
