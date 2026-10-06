// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { gradientDef, placeMask } from '../src/mask.js';
import { tintSvg } from '../src/svg.js';

/**
 * Where a CSS mask lands inside its element, which is the whole of what the
 * browser draws for a logo painted as a tinted mask.
 */

const BOX = { w: 120, h: 120 };
const WIDE = { w: 40, h: 20 };

describe('mask-size', () => {
  it('contain fits the whole mask in, and centre puts it in the middle', () => {
    expect(placeMask(BOX, WIDE, 'contain', '50% 50%')).toEqual({ x: 0, y: 30, w: 120, h: 60 });
  });

  it('cover fills the box and lets the long side hang over', () => {
    expect(placeMask(BOX, WIDE, 'cover', '50% 50%')).toEqual({ x: -60, y: 0, w: 240, h: 120 });
  });

  it('a percentage is of the box, and an auto side keeps the proportions', () => {
    expect(placeMask(BOX, WIDE, '50%', '0% 0%')).toEqual({ x: 0, y: 0, w: 60, h: 30 });
    expect(placeMask(BOX, WIDE, 'auto 50%', '0% 0%')).toEqual({ x: 0, y: 0, w: 120, h: 60 });
  });

  it('two lengths are taken as they are', () => {
    expect(placeMask(BOX, WIDE, '30px 10px', '0px 0px')).toEqual({ x: 0, y: 0, w: 30, h: 10 });
  });

  it('auto is the mask at its own size', () => {
    expect(placeMask(BOX, WIDE, 'auto', '50% 50%')).toEqual({ x: 40, y: 50, w: 40, h: 20 });
  });

  it('a mask with no size of its own takes the box', () => {
    expect(placeMask({ w: 80, h: 40 }, null, 'contain', '50% 50%')).toEqual({ x: 0, y: 0, w: 80, h: 40 });
  });
});

describe('mask-position', () => {
  it('reads keywords, either way round', () => {
    expect(placeMask(BOX, WIDE, 'contain', 'center')).toEqual({ x: 0, y: 30, w: 120, h: 60 });
    expect(placeMask(BOX, WIDE, 'auto', 'right bottom')).toEqual({ x: 80, y: 100, w: 40, h: 20 });
    expect(placeMask(BOX, WIDE, 'auto', 'bottom right')).toEqual({ x: 80, y: 100, w: 40, h: 20 });
  });

  it('a percentage is of the free space, a length is from the edge', () => {
    expect(placeMask(BOX, WIDE, 'auto', '25% 10px')).toEqual({ x: 20, y: 10, w: 40, h: 20 });
  });

  it('reads an edge offset the browser wrote as calc()', () => {
    expect(placeMask(BOX, WIDE, 'auto', 'calc(100% - 10px) calc(100% - 5px)')).toEqual({
      x: 70,
      y: 95,
      w: 40,
      h: 20,
    });
  });
});

describe('painting a mask', () => {
  it('runs a gradient across the element, not across the shape', () => {
    // 90deg is left to right: the line spans the box's width through its middle.
    const def = gradientDef(
      {
        type: 'linear',
        angle: 90,
        stops: [
          { at: 0, color: '#9c4679', opacity: 1 },
          { at: 1, color: '#2f6fdb', opacity: 1 },
        ],
      },
      { x: 0, y: -10, w: 40, h: 40 },
      'tint',
    );
    expect(def).toContain('x1="0" y1="10" x2="40" y2="10"');
    expect(def).toContain('<stop offset="1" stop-color="#2f6fdb" stop-opacity="1"/>');
  });

  it('every shape takes the tint, and what painted nothing stays empty', () => {
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><style>rect{fill:red}</style>' +
      '<rect width="20" height="20" fill="#000000"/><circle cx="30" cy="10" r="8" fill="none" stroke="#000000"/>' +
      '<path d="M0 0h1"/></svg>';
    const tinted = tintSvg(markup, '#9c4679');
    expect(tinted).toContain('<rect width="20" height="20" fill="#9c4679"/>');
    expect(tinted).toContain('fill="none" stroke="#9c4679"');
    expect(tinted).toContain('<path d="M0 0h1" fill="#9c4679"/>');
    expect(tinted).not.toContain('<style');
  });
});
