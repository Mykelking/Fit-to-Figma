import type { Node as TreeNode } from '@fit-to-figma/tree';
import { beforeEach, describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame, FakeText } from './fake-figma.js';
import { kids, node, tree } from './helpers.js';

let file: FakeFile;

beforeEach(() => {
  file = installFigma();
  figma.viewport.center = { x: 0, y: 0 };
});

const LINES = [
  { text: 'first line here', x: 16, y: 64, w: 300, h: 20 },
  { text: 'and the rest', x: 16, y: 90, w: 120, h: 20 },
];

const FONT = { family: 'Inter', weight: 400, style: 'normal', size: 16, lineHeight: 20, letterSpacing: 0 };

function paragraph(align = 'left') {
  return node({
    type: 'text',
    id: 'p1',
    name: 'p.lede',
    x: 16,
    y: 64,
    w: 358,
    h: 46,
    text: {
      content: 'first line here and the rest',
      font: FONT,
      color: '#111111',
      opacity: 1,
      align,
      decoration: 'none',
      transform: 'none',
      lines: 2,
      lineBoxes: LINES,
    },
  } as never);
}

function float() {
  return node({
    type: 'frame',
    id: 'f1',
    name: 'div.float',
    x: 306,
    y: 292,
    w: 56,
    h: 56,
    flow: 'absolute',
    sizing: { w: 'fill', h: 'fixed' },
  } as never);
}

function column(children: TreeNode[]) {
  return tree(
    node({
      type: 'frame',
      id: 'root',
      name: 'body',
      x: 0,
      y: 0,
      w: 390,
      h: 400,
      layout: { mode: 'column', gap: 8, padding: [0, 0, 0, 0], align: 'start', justify: 'start', wrap: false },
      children,
    } as never),
  );
}

const exact = { bindVariables: false, updateById: false, exact: true };
const editable = { bindVariables: false, updateById: false, exact: false };

function root(): FakeFrame {
  return file.page.children[0] as FakeFrame;
}

describe('exact positions', () => {
  it('gives no frame auto layout, and ignores sizing with it', async () => {
    const report = await build([column([float()])], exact);
    expect(root().layoutMode).toBe('NONE');
    const made = kids(root())[0] as FakeFrame;
    expect([made.x, made.y]).toEqual([306, 292]);
    expect(made.layoutSizingHorizontal).toBe('FIXED');
    expect(report.warnings).toEqual([]);
  });

  it('draws a wrapped run as one layer per line, at the lines the browser drew', async () => {
    await build([column([paragraph()])], exact);
    const lines = kids(root()) as FakeText[];
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.characters)).toEqual(['first line here', 'and the rest']);
    expect(lines.map((l) => [l.x, l.y])).toEqual([
      [16, 64],
      [16, 90],
    ]);
    expect(lines.map((l) => l.name)).toEqual(['p.lede · line 1', 'p.lede · line 2']);
    expect(lines.every((l) => l.textAutoResize === 'WIDTH_AND_HEIGHT')).toBe(true);
  });

  it('a right aligned line keeps its right edge', async () => {
    await build([column([paragraph('right')])], exact);
    const second = kids(root())[1] as FakeText;
    // The line box is 120 wide and the fake measures the words at 96.
    expect(second.x).toBe(16 + 120 - second.width);
  });

  it('counts each line as the text layer it is', async () => {
    const report = await build([column([paragraph()])], exact);
    expect(report.texts).toBe(2);
    expect(file.page.findAll((n) => n.type === 'TEXT')).toHaveLength(2);
  });
});

describe('auto layout, the editable way', () => {
  it('keeps the browser line breaks in one layer', async () => {
    await build([column([paragraph()])], editable);
    const made = kids(root()) as FakeText[];
    expect(made).toHaveLength(1);
    expect(made[0]?.characters).toBe('first line here\nand the rest');
  });

  it('takes an out of flow child out of the layout and places it', async () => {
    const report = await build([column([paragraph(), float()])], editable);
    expect(root().layoutMode).toBe('VERTICAL');
    const made = kids(root())[1] as FakeFrame;
    expect(made.layoutPositioning).toBe('ABSOLUTE');
    expect([made.x, made.y]).toEqual([306, 292]);
    // Out of the flow means out of the sizing too: fill would be meaningless.
    expect(made.layoutSizingHorizontal).toBe('FIXED');
    expect(report.warnings).toEqual([]);
  });

  it('leaves a child of a frame with no layout exactly as before', async () => {
    const plain = tree(
      node({ type: 'frame', id: 'root', name: 'body', w: 390, h: 400, children: [float()] } as never),
    );
    await build([plain], editable);
    const made = kids(root())[0] as FakeFrame;
    expect(made.layoutPositioning).toBe('AUTO');
    expect([made.x, made.y]).toEqual([306, 292]);
  });
});
