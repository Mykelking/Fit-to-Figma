import { describe, expect, it } from 'vitest';
import { build } from '../src/main/build.js';
import { installFigma } from './fake-figma.js';
import type { FakeFile, FakeFrame } from './fake-figma.js';
import { node, tree } from './helpers.js';

let file: FakeFile;

const TOKENS = [
  { name: '--color-primary', value: '#9c4679', kind: 'color' as const },
  { name: '--radius-lg', value: '16px', kind: 'number' as const },
];

function withTokens() {
  return tree(node({ type: 'frame', fills: [{ type: 'solid', color: '#9C4679', opacity: 1 }] }), {
    tokens: TOKENS,
    source: { kind: 'file', ref: 'a.html', title: 'Sign in', capturedAt: '', viewport: { w: 390, h: 844 } },
  });
}

describe('colour tokens', () => {
  it('makes one collection named after the source with one mode', async () => {
    file = installFigma();
    const report = await build([withTokens()], { bindVariables: true, updateById: false });
    expect(file.collections).toHaveLength(1);
    expect(file.collections[0]?.name).toBe('Sign in');
    expect(file.collections[0]?.modes).toHaveLength(1);
    expect(file.collections[0]?.variables.map((v) => v.name)).toEqual(['--color-primary']);
    expect(report.tokens).toBe('variables');
  });

  it('binds a solid that equals a token, whatever the case of the hex', async () => {
    file = installFigma();
    const report = await build([withTokens()], { bindVariables: true, updateById: false });
    const fill = ((file.page.children[0] as FakeFrame).fills as Array<Record<string, unknown>>)[0];
    expect(fill?.boundVariables).toBeTruthy();
    expect(report.tokensBound).toBe(1);
  });

  it('leaves a colour that matches no token unbound', async () => {
    file = installFigma();
    const report = await build(
      [
        tree(node({ type: 'frame', fills: [{ type: 'solid', color: '#123456', opacity: 1 }] }), { tokens: TOKENS }),
      ],
      { bindVariables: true, updateById: false },
    );
    const fill = ((file.page.children[0] as FakeFrame).fills as Array<Record<string, unknown>>)[0];
    expect(fill?.boundVariables).toBeUndefined();
    expect(report.tokensBound).toBe(0);
  });

  it('does nothing when the option is off', async () => {
    file = installFigma();
    const report = await build([withTokens()], { bindVariables: false, updateById: false });
    expect(file.collections).toHaveLength(0);
    expect(report.tokens).toBe('none');
  });

  it('falls back to paint styles when the file has no variables, and says so', async () => {
    file = installFigma({ variables: false });
    const report = await build([withTokens()], { bindVariables: true, updateById: false });
    expect(report.tokens).toBe('styles');
    expect(file.paintStyles).toHaveLength(1);
    expect(file.paintStyles[0]?.name).toBe('Sign in/color-primary');
    expect((file.page.children[0] as FakeFrame).fillStyleId).toBe(file.paintStyles[0]?.id);
    expect(report.warnings.join(' ')).toContain('paint styles');
  });

  function scrim() {
    return tree(node({ type: 'frame', fills: [{ type: 'solid', color: '#9c4679', opacity: 0.48 }] }), {
      tokens: TOKENS,
    });
  }

  it('a see-through colour keeps its own paint rather than taking a style', async () => {
    file = installFigma({ variables: false });
    const report = await build([scrim()], { bindVariables: true, updateById: false });
    const frame = file.page.children[0] as FakeFrame;
    // A paint style carries no per layer opacity: the style would draw it solid.
    expect(frame.fillStyleId).toBe('');
    expect((frame.fills as Array<Record<string, unknown>>)[0]?.opacity).toBe(0.48);
    expect(report.tokensBound).toBe(0);
  });

  it('a variable binds the colour and leaves the opacity alone', async () => {
    file = installFigma();
    const report = await build([scrim()], { bindVariables: true, updateById: false });
    const fill = ((file.page.children[0] as FakeFrame).fills as Array<Record<string, unknown>>)[0];
    expect(fill?.boundVariables).toBeTruthy();
    expect(fill?.opacity).toBe(0.48);
    expect(report.tokensBound).toBe(1);
  });

  it('carries on with neither variables nor styles', async () => {
    file = installFigma({ variables: false, paintStyles: false });
    const report = await build([withTokens()], { bindVariables: true, updateById: false });
    expect(report.tokens).toBe('none');
    expect(report.nodes).toBe(1);
  });
});
