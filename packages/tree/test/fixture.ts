import type { DesignTree } from '../src/index.js';

/** A small but complete tree: every optional field is used somewhere. */
export function validTree(): DesignTree {
  return {
    version: 1,
    source: {
      kind: 'url',
      ref: 'https://example.com/pricing',
      title: 'Pricing',
      capturedAt: '2026-09-22T09:30:00Z',
      viewport: { w: 390, h: 844 },
    },
    page: 'Screens',
    place: { x: 1200, y: -80 },
    fonts: [{ family: 'Plus Jakarta Sans', weights: [400, 600, 700] }],
    assets: {
      a1: { type: 'image', mime: 'image/png', data: 'iVBORw0KGgo=', w: 48, h: 48 },
      a2: { type: 'svg', mime: 'image/svg+xml', data: '<svg/>', w: 16, h: 16 },
    },
    tokens: [{ name: '--color-primary', value: '#9c4679', kind: 'color' }],
    root: {
      id: 'n1',
      name: 'body',
      type: 'frame',
      x: 0,
      y: 0,
      w: 390,
      h: 844,
      layout: {
        mode: 'column',
        gap: 16,
        padding: [24, 16, 24, 16],
        align: 'stretch',
        justify: 'start',
        wrap: false,
      },
      sizing: { w: 'fixed', h: 'hug' },
      fills: [{ type: 'solid', color: '#ffffff', opacity: 1 }],
      opacity: 1,
      clip: true,
      semantic: { tag: 'body', classes: [] },
      children: [
        {
          id: 'n2',
          name: 'button.btn.btn--primary',
          type: 'frame',
          x: 16,
          y: 24,
          w: 358,
          h: 48,
          layout: {
            mode: 'row',
            gap: 8,
            padding: [12, 16, 12, 16],
            align: 'center',
            justify: 'center',
            wrap: false,
          },
          sizing: { w: 'fill', h: 'fixed' },
          fills: [
            {
              type: 'linear',
              angle: 135,
              stops: [
                { at: 0, color: '#9c4679', opacity: 1 },
                { at: 1, color: '#000000', opacity: 0 },
              ],
            },
          ],
          strokes: { color: '#9c4679', opacity: 1, weight: 1, align: 'inside' },
          radius: [12, 12, 12, 12],
          effects: [
            { type: 'shadow', x: 0, y: 2, blur: 8, spread: 0, color: '#000000', opacity: 0.15 },
            { type: 'inner-shadow', x: 0, y: 1, blur: 0, spread: 0, color: '#ffffff', opacity: 1 },
            { type: 'blur', radius: 12 },
            { type: 'backdrop-blur', radius: 20 },
          ],
          semantic: { tag: 'button', classes: ['btn', 'btn--primary'], role: 'button' },
          children: [
            {
              id: 'n3',
              name: 'Join',
              type: 'text',
              x: 160,
              y: 36,
              w: 70,
              h: 24,
              text: {
                content: 'Join',
                font: {
                  family: 'Plus Jakarta Sans',
                  weight: 700,
                  style: 'normal',
                  size: 16,
                  lineHeight: 24,
                  letterSpacing: 0,
                },
                color: '#ffffff',
                opacity: 1,
                align: 'center',
                decoration: 'none',
                transform: 'none',
              },
              semantic: { tag: 'span', classes: [] },
            },
            {
              id: 'n4',
              name: 'icon',
              type: 'vector',
              x: 240,
              y: 40,
              w: 16,
              h: 16,
              asset: 'a2',
              semantic: { tag: 'svg', classes: [] },
            },
          ],
        },
        {
          id: 'n5',
          name: 'img.hero',
          type: 'image',
          x: 16,
          y: 88,
          w: 48,
          h: 48,
          asset: 'a1',
          fills: [{ type: 'image', asset: 'a1', scale: 'fill' }],
          semantic: { tag: 'img', classes: ['hero'] },
        },
      ],
    },
  };
}

/** Deep clone that keeps it plain JSON, like a file that came off disk. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Drop the field a dotted path points at: 'root.children.0.id'. */
export function drop(tree: unknown, path: string): unknown {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return tree;
  let cursor = tree as Record<string, unknown>;
  for (const part of parts) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  delete cursor[last];
  return tree;
}

/** Put a value where a dotted path points. */
export function put(tree: unknown, path: string, value: unknown): unknown {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return tree;
  let cursor = tree as Record<string, unknown>;
  for (const part of parts) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[last] = value;
  return tree;
}
