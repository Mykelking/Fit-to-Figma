import { describe, expect, it } from 'vitest';
import { mapGap, mapLayout, mapPadding, mapSizing } from '../src/index.js';

describe('mapLayout', () => {
  it('reads a flex row whole', () => {
    const { layout, notes } = mapLayout({
      display: 'flex',
      'flex-direction': 'row',
      gap: '8px',
      padding: '12px 16px 12px 16px',
      'align-items': 'center',
      'justify-content': 'space-between',
      'flex-wrap': 'nowrap',
    });
    expect(layout).toEqual({
      mode: 'row',
      gap: 8,
      padding: [12, 16, 12, 16],
      align: 'center',
      justify: 'space-between',
      wrap: false,
    });
    expect(notes).toEqual([]);
  });

  it('reads a flex column with the longhand padding a browser gives', () => {
    const { layout } = mapLayout({
      display: 'flex',
      flexDirection: 'column',
      rowGap: '24px',
      columnGap: '24px',
      paddingTop: '32px',
      paddingRight: '16px',
      paddingBottom: '32px',
      paddingLeft: '16px',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
      flexWrap: 'wrap',
    });
    expect(layout).toEqual({
      mode: 'column',
      gap: 24,
      padding: [32, 16, 32, 16],
      align: 'stretch',
      justify: 'start',
      wrap: true,
    });
  });

  it('takes column-gap for a row and row-gap for a column', () => {
    const style = { display: 'flex', 'row-gap': '4px', 'column-gap': '20px' };
    expect(mapLayout({ ...style, 'flex-direction': 'row' }).layout?.gap).toBe(20);
    expect(mapLayout({ ...style, 'flex-direction': 'column' }).layout?.gap).toBe(4);
  });

  it('notes two different gaps on a wrapping row', () => {
    const { layout, notes } = mapLayout({
      display: 'flex',
      'flex-wrap': 'wrap',
      'row-gap': '4px',
      'column-gap': '20px',
    });
    expect(layout?.gap).toBe(20);
    expect(notes.join(' ')).toMatch(/differ/);
  });

  it('lays a reversed direction out forwards and says so', () => {
    const { layout, notes } = mapLayout({ display: 'flex', 'flex-direction': 'row-reverse' });
    expect(layout?.mode).toBe('row');
    expect(notes.join(' ')).toMatch(/forwards/);
  });

  it('maps the alignment words a browser gives', () => {
    const at = (align: string, justify: string) =>
      mapLayout({ display: 'flex', 'align-items': align, 'justify-content': justify }).layout;
    expect(at('flex-start', 'flex-end')).toMatchObject({ align: 'start', justify: 'end' });
    expect(at('normal', 'normal')).toMatchObject({ align: 'stretch', justify: 'start' });
    expect(at('end', 'left')).toMatchObject({ align: 'end', justify: 'start' });
  });

  it('turns baseline into start and space-around into space-between, with notes', () => {
    const { layout, notes } = mapLayout({
      display: 'flex',
      'align-items': 'baseline',
      'justify-content': 'space-evenly',
    });
    expect(layout).toMatchObject({ align: 'start', justify: 'space-between' });
    expect(notes).toHaveLength(2);
  });

  it('turns a grid of equal tracks into a wrapping row', () => {
    const { layout, notes, track } = mapLayout({
      display: 'grid',
      'grid-template-columns': '176px 176px',
      gap: '16px',
      padding: '0px',
    });
    expect(layout).toEqual({
      mode: 'row',
      gap: 16,
      padding: [0, 0, 0, 0],
      align: 'stretch',
      justify: 'start',
      wrap: true,
    });
    expect(track).toBe(176);
    expect(notes.join(' ')).toMatch(/equal tracks/);
  });

  it('a one track grid is still a wrapping row', () => {
    const { layout, track } = mapLayout({
      display: 'grid',
      'grid-template-columns': '352px',
    });
    expect(layout?.wrap).toBe(true);
    expect(track).toBe(352);
  });

  it('leaves an uneven grid absolute', () => {
    const { layout, notes } = mapLayout({
      display: 'grid',
      'grid-template-columns': '120px 240px',
    });
    expect(layout).toBeNull();
    expect(notes.join(' ')).toMatch(/stayed absolute/);
  });

  it('leaves a grid with no tracks absolute', () => {
    expect(mapLayout({ display: 'grid', 'grid-template-columns': 'none' }).layout).toBeNull();
  });

  it('anything that is not flex or grid has no layout', () => {
    expect(mapLayout({ display: 'block' }).layout).toBeNull();
    expect(mapLayout({ display: 'inline' }).layout).toBeNull();
    expect(mapLayout({}).layout).toBeNull();
  });

  it('reads gaps and padding in em', () => {
    const { layout } = mapLayout(
      { display: 'flex', gap: '1em', padding: '0.5em' },
      { font: 16 },
    );
    expect(layout).toMatchObject({ gap: 16, padding: [8, 8, 8, 8] });
  });
});

describe('mapPadding and mapGap', () => {
  it('expands the shorthand the CSS way', () => {
    expect(mapPadding({ padding: '4px' })).toEqual([4, 4, 4, 4]);
    expect(mapPadding({ padding: '4px 8px' })).toEqual([4, 8, 4, 8]);
    expect(mapPadding({ padding: '4px 8px 12px' })).toEqual([4, 8, 12, 8]);
    expect(mapPadding({ padding: '4px 8px 12px 16px' })).toEqual([4, 8, 12, 16]);
    expect(mapPadding({})).toEqual([0, 0, 0, 0]);
  });

  it('mapGap picks the axis', () => {
    expect(mapGap({ gap: '8px 24px' }, 'row')).toBe(24);
    expect(mapGap({ gap: '8px 24px' }, 'column')).toBe(8);
    expect(mapGap({}, 'row')).toBe(0);
  });
});

describe('mapSizing', () => {
  it('reads width auto, 100% and px', () => {
    const loose = { parentAlign: 'center' } as const;
    expect(mapSizing({ width: 'auto', height: 'auto' }, loose)).toEqual({ w: 'hug', h: 'hug' });
    expect(mapSizing({ width: '100%', height: 'auto' }, loose)).toEqual({
      w: 'fill',
      h: 'hug',
    });
    expect(mapSizing({ width: '320px', height: '48px' }, loose)).toEqual({
      w: 'fixed',
      h: 'fixed',
    });
  });

  it('with no parent alignment given, CSS stretches the cross axis', () => {
    expect(mapSizing({ width: 'auto', height: 'auto' })).toEqual({ w: 'hug', h: 'fill' });
  });

  it('flex-grow fills the main axis', () => {
    expect(mapSizing({ 'flex-grow': '1', width: '0px' }, { parentMode: 'row' })).toMatchObject({
      w: 'fill',
    });
    expect(
      mapSizing({ 'flex-grow': '1', height: '0px' }, { parentMode: 'column' }),
    ).toMatchObject({ h: 'fill' });
    expect(mapSizing({ 'flex-grow': '0', width: '100px' })).toMatchObject({ w: 'fixed' });
  });

  it('reads flex-grow out of the flex shorthand', () => {
    expect(mapSizing({ flex: '1 1 0%' }, { parentMode: 'row' })).toMatchObject({ w: 'fill' });
    expect(mapSizing({ flex: '0 0 auto' }, { parentMode: 'row' })).toMatchObject({ w: 'hug' });
  });

  it('align-self stretch fills the cross axis, unless it is already fixed', () => {
    expect(
      mapSizing({ 'align-self': 'stretch', height: 'auto' }, { parentMode: 'row' }),
    ).toMatchObject({ h: 'fill' });
    expect(
      mapSizing({ 'align-self': 'stretch', height: '48px' }, { parentMode: 'row' }),
    ).toMatchObject({ h: 'fixed' });
    expect(
      mapSizing({ 'align-self': 'center', height: 'auto' }, { parentMode: 'row' }),
    ).toMatchObject({ h: 'hug' });
  });

  it('align-self auto takes the parent alignment', () => {
    expect(
      mapSizing({ 'align-self': 'auto' }, { parentMode: 'row', parentAlign: 'stretch' }),
    ).toMatchObject({ h: 'fill' });
    expect(
      mapSizing({ 'align-self': 'auto' }, { parentMode: 'row', parentAlign: 'center' }),
    ).toMatchObject({ h: 'hug' });
  });

  it('a column stretches the width instead', () => {
    expect(
      mapSizing({ width: 'auto' }, { parentMode: 'column', parentAlign: 'stretch' }),
    ).toMatchObject({ w: 'fill' });
  });
});
