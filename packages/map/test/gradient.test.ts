import { describe, expect, it } from 'vitest';
import { gradientFallback, mapGradient } from '../src/index.js';

describe('mapGradient', () => {
  it('reads an angle and two stops', () => {
    const result = mapGradient('linear-gradient(90deg, #9c4679 0%, #ffffff 100%)');
    expect(result?.paint).toEqual({
      type: 'linear',
      angle: 90,
      stops: [
        { at: 0, color: '#9c4679', opacity: 1 },
        { at: 1, color: '#ffffff', opacity: 1 },
      ],
    });
    expect(result?.notes).toEqual([]);
  });

  it('reads side keywords', () => {
    expect(mapGradient('linear-gradient(to right, red, blue)')?.paint).toMatchObject({
      angle: 90,
    });
    expect(mapGradient('linear-gradient(to top, red, blue)')?.paint).toMatchObject({ angle: 0 });
    expect(mapGradient('linear-gradient(to left, red, blue)')?.paint).toMatchObject({
      angle: 270,
    });
  });

  it('takes the diagonal for a corner and says so', () => {
    const result = mapGradient('linear-gradient(to bottom right, #fff 0%, transparent 100%)');
    expect(result?.paint).toEqual({
      type: 'linear',
      angle: 135,
      stops: [
        { at: 0, color: '#ffffff', opacity: 1 },
        { at: 1, color: '#000000', opacity: 0 },
      ],
    });
    expect(result?.notes.join(' ')).toMatch(/corner/);
  });

  it('defaults to top down with no direction', () => {
    expect(mapGradient('linear-gradient(#fff, #000)')?.paint).toMatchObject({ angle: 180 });
  });

  it('spaces the stops the page left out', () => {
    const result = mapGradient('linear-gradient(red, green, blue)');
    expect(result?.paint).toMatchObject({
      stops: [
        { at: 0, color: '#ff0000' },
        { at: 0.5, color: '#008000' },
        { at: 1, color: '#0000ff' },
      ],
    });
  });

  it('spaces a run of gaps evenly between what is known', () => {
    const result = mapGradient('linear-gradient(red 20%, green, blue, white 80%)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops.map((stop) => stop.at)).toEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it('never lets a stop go backwards', () => {
    const result = mapGradient('linear-gradient(red 60%, blue 20%)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops.map((stop) => stop.at)).toEqual([0.6, 0.6]);
  });

  it('turns a double position into two stops', () => {
    const result = mapGradient('linear-gradient(red 0% 50%, blue 50% 100%)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops).toEqual([
      { at: 0, color: '#ff0000', opacity: 1 },
      { at: 0.5, color: '#ff0000', opacity: 1 },
      { at: 0.5, color: '#0000ff', opacity: 1 },
      { at: 1, color: '#0000ff', opacity: 1 },
    ]);
  });

  it('reads a stop in pixels when the gradient line length is known', () => {
    const result = mapGradient('linear-gradient(to right, red 0px, blue 50px)', {
      lineLength: 200,
    });
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops.map((stop) => stop.at)).toEqual([0, 0.25]);
  });

  it('spaces a pixel stop evenly when the line length is unknown, with a note', () => {
    const result = mapGradient('linear-gradient(to right, red 0px, green 50px, blue 100px)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops.map((stop) => stop.at)).toEqual([0, 0.5, 1]);
    expect(result?.notes.join(' ')).toMatch(/line length is unknown/);
  });

  it('carries alpha through from rgba stops', () => {
    const result = mapGradient(
      'linear-gradient(180deg, rgba(156, 70, 121, 0.4) 0%, rgba(0,0,0,.15) 100%)',
    );
    expect(result?.paint).toMatchObject({
      stops: [
        { at: 0, color: '#9c4679', opacity: 0.4 },
        { at: 1, color: '#000000', opacity: 0.15 },
      ],
    });
  });

  it('flattens a radial gradient and says so', () => {
    const result = mapGradient('radial-gradient(circle at 50% 50%, #fff 0%, #000 100%)');
    expect(result?.paint).toMatchObject({
      type: 'linear',
      angle: 180,
      stops: [
        { at: 0, color: '#ffffff' },
        { at: 1, color: '#000000' },
      ],
    });
    expect(result?.notes.join(' ')).toMatch(/radial/);
  });

  it('flattens a radial gradient with no shape part', () => {
    const result = mapGradient('radial-gradient(#fff, #000)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops).toHaveLength(2);
  });

  it('makes a conic gradient a solid of its first stop', () => {
    const result = mapGradient('conic-gradient(from 90deg, #9c4679, #fff)');
    expect(result?.paint).toEqual({ type: 'solid', color: '#9c4679', opacity: 1 });
    expect(result?.notes.join(' ')).toMatch(/solid/);
  });

  it('makes a one stop gradient a solid', () => {
    const result = mapGradient('linear-gradient(#9c4679, #9c4679)');
    expect(result?.paint.type).toBe('linear');
    expect(mapGradient('linear-gradient(#9c4679)')?.paint).toEqual({
      type: 'solid',
      color: '#9c4679',
      opacity: 1,
    });
  });

  it('notes a repeating gradient', () => {
    const result = mapGradient('repeating-linear-gradient(45deg, #fff 0px, #000 10px)');
    expect(result?.notes.join(' ')).toMatch(/repeating/);
    expect(result?.paint).toMatchObject({ angle: 45 });
  });

  it('drops a colour hint', () => {
    const result = mapGradient('linear-gradient(red, 30%, blue)');
    const stops = result?.paint.type === 'linear' ? result.paint.stops : [];
    expect(stops).toHaveLength(2);
    expect(result?.notes.join(' ')).toMatch(/hint/);
  });

  it('returns null for what is not a gradient', () => {
    expect(mapGradient('#fff')).toBeNull();
    expect(mapGradient('url(a.png)')).toBeNull();
    expect(mapGradient('none')).toBeNull();
    expect(mapGradient('')).toBeNull();
  });

  it('gradientFallback gives the first stop as a solid', () => {
    expect(gradientFallback('linear-gradient(to right, #9c4679, #fff)')).toEqual({
      type: 'solid',
      color: '#9c4679',
      opacity: 1,
    });
    expect(gradientFallback('#fff')).toBeNull();
  });
});
