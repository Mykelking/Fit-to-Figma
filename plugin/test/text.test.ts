import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { styleName } from '../src/main/fonts.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame, FakeText } from './fake-figma.js';
import { kids, node, tree } from './helpers.js';

const INTER = ['Thin', 'Extra Light', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Extra Bold', 'Black', 'Italic', 'Bold Italic'];
const options = { bindVariables: false, updateById: false };

let file: FakeFile;

beforeEach(() => {
  file = installFigma({ fonts: { Inter: INTER, 'Plus Jakarta Sans': ['Regular', 'Bold', 'Bold Italic'] } });
});

function textNode(style: Record<string, unknown>, content = 'Join'): ReturnType<typeof node> {
  return node({
    type: 'text',
    w: 80,
    h: 24,
    text: {
      content,
      font: { family: 'Plus Jakarta Sans', weight: 700, style: 'normal', size: 16, lineHeight: 24, letterSpacing: 0 },
      color: '#111111',
      opacity: 1,
      align: 'left',
      decoration: 'none',
      transform: 'none',
      ...style,
    },
  } as never);
}

async function buildText(style: Record<string, unknown>, content = 'Join'): Promise<FakeText> {
  file = installFigma({ fonts: { Inter: INTER, 'Plus Jakarta Sans': ['Regular', 'Bold', 'Bold Italic'] } });
  await build([tree(node({ type: 'frame', children: [textNode(style, content)] }))], options);
  return kids(file.page.children[0] as FakeFrame)[0] as FakeText;
}

describe('weight to a Figma style name', () => {
  it('names the nine weights', () => {
    expect(styleName(100, false)).toBe('Thin');
    expect(styleName(400, false)).toBe('Regular');
    expect(styleName(600, false)).toBe('Semi Bold');
    expect(styleName(900, false)).toBe('Black');
  });

  it('rounds an off weight to the nearest', () => {
    expect(styleName(450, false)).toBe('Regular');
    expect(styleName(650, false)).toBe('Semi Bold');
  });

  it('adds Italic, and Regular Italic is just Italic', () => {
    expect(styleName(400, true)).toBe('Italic');
    expect(styleName(700, true)).toBe('Bold Italic');
  });
});

describe('text nodes', () => {
  it('loads the font before setting it, and keeps family, size and spacing', async () => {
    const text = await buildText({});
    expect(text.fontName).toEqual({ family: 'Plus Jakarta Sans', style: 'Bold' });
    expect(file.loadedFonts).toContainEqual({ family: 'Plus Jakarta Sans', style: 'Bold' });
    expect(text.characters).toBe('Join');
    expect(text.fontSize).toBe(16);
    expect(text.lineHeight).toEqual({ unit: 'PIXELS', value: 24 });
  });

  it('carries letter spacing, alignment and decoration', async () => {
    const text = await buildText({
      font: { family: 'Plus Jakarta Sans', weight: 700, style: 'normal', size: 16, lineHeight: 24, letterSpacing: 1.5 },
      align: 'center',
      decoration: 'underline',
    });
    expect(text.letterSpacing).toEqual({ unit: 'PIXELS', value: 1.5 });
    expect(text.textAlignHorizontal).toBe('CENTER');
    expect(text.textDecoration).toBe('UNDERLINE');
  });

  it('applies the case from transform', async () => {
    expect((await buildText({ transform: 'upper' }, 'Join')).characters).toBe('JOIN');
    expect((await buildText({ transform: 'lower' }, 'Join')).characters).toBe('join');
  });

  it('paints the colour and keeps the box', async () => {
    const text = await buildText({ color: '#9c4679' });
    expect(text.fills).toEqual([{ type: 'SOLID', color: { r: 156 / 255, g: 70 / 255, b: 121 / 255 }, opacity: 1 }]);
    expect(text.textAutoResize).toBe('NONE');
    expect([text.width, text.height]).toEqual([80, 24]);
  });

  it('falls back to Inter at the same weight and lists the family once', async () => {
    const missing = {
      content: 'Hi',
      font: { family: 'Sohne', weight: 600, style: 'normal', size: 14, lineHeight: 20, letterSpacing: 0 },
      color: '#000000',
      opacity: 1,
      align: 'left',
      decoration: 'none',
      transform: 'none',
    };
    const report = await build(
      [
        tree(
          node({
            type: 'frame',
            children: [
              node({ type: 'text', w: 40, h: 20, text: missing } as never),
              node({ type: 'text', w: 40, h: 20, text: { ...missing, content: 'There' } } as never),
            ],
          }),
        ),
      ],
      options,
    );
    const first = kids(file.page.children[0] as FakeFrame)[0] as FakeText;
    expect(first.fontName).toEqual({ family: 'Inter', style: 'Semi Bold' });
    expect(report.fontsMissing).toEqual(['Sohne']);
    expect(report.texts).toBe(2);
  });

  it('falls back to Regular when the family lacks the weight', async () => {
    const text = await buildText({ font: { family: 'Plus Jakarta Sans', weight: 300, style: 'normal', size: 12, lineHeight: 16, letterSpacing: 0 } });
    expect(text.fontName).toEqual({ family: 'Plus Jakarta Sans', style: 'Regular' });
  });

  it('skips a text node with no text and reports it', async () => {
    const report = await build(
      [tree(node({ type: 'frame', children: [node({ type: 'text', name: 'empty' })] }))],
      options,
    );
    expect(kids(file.page.children[0] as FakeFrame)).toHaveLength(0);
    expect(report.warnings.join(' ')).toContain('no text');
  });
});
