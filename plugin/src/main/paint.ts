import type { Corners, Effect, Paint as TreePaint, Stroke } from '@fit-to-figma/tree';
import { clamp01, hexAlpha, hexToRgb } from './colour.js';
import type { AssetStore } from './assets.js';
import type { TokenStore } from './tokens.js';

/**
 * CSS reads 0deg as "to top" and turns clockwise. Figma wants a transform that
 * rotates the unit square so the gradient runs along its x axis.
 */
export function gradientTransform(angleDeg: number): Transform {
  const rad = ((Number.isFinite(angleDeg) ? angleDeg : 180) * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  return [
    [dx, dy, 0.5 - 0.5 * dx - 0.5 * dy],
    [-dy, dx, 0.5 + 0.5 * dy - 0.5 * dx],
  ];
}

/** The typings have no exported name for this. */
export type StrokeAlignment = 'INSIDE' | 'CENTER' | 'OUTSIDE';

export interface PaintContext {
  assets: AssetStore;
  tokens: TokenStore;
  warn: (text: string) => void;
}

export interface PaintResult {
  paints: Paint[];
  /** Set when a colour bound to a paint style rather than a variable. */
  styleId?: string;
}

export function toPaints(fills: TreePaint[] | undefined, ctx: PaintContext): PaintResult {
  if (!Array.isArray(fills) || fills.length === 0) return { paints: [] };
  const paints: Paint[] = [];
  let styleId: string | undefined;

  for (const fill of fills) {
    if (!fill || typeof fill !== 'object') continue;
    if (fill.type === 'solid') {
      const opacity = clamp01(fill.opacity === undefined ? hexAlpha(fill.color) : fill.opacity);
      const solid: SolidPaint = { type: 'SOLID', color: hexToRgb(fill.color), opacity };
      const bound = ctx.tokens.bind(solid, fill.color);
      if (bound.styleId !== undefined) styleId = bound.styleId;
      paints.push(bound.paint);
      continue;
    }
    if (fill.type === 'linear') {
      const stops = Array.isArray(fill.stops) ? fill.stops : [];
      if (stops.length === 0) continue;
      paints.push({
        type: 'GRADIENT_LINEAR',
        gradientTransform: gradientTransform(fill.angle),
        gradientStops: stops.map((s) => {
          const rgb = hexToRgb(s.color);
          const a = clamp01(s.opacity === undefined ? hexAlpha(s.color) : s.opacity);
          return { position: clamp01(s.at), color: { r: rgb.r, g: rgb.g, b: rgb.b, a } };
        }),
      });
      continue;
    }
    if (fill.type === 'image') {
      const hash = ctx.assets.imageHash(fill.asset);
      if (hash === null) {
        ctx.warn('asset ' + fill.asset + ' could not be read and was skipped');
        continue;
      }
      paints.push({ type: 'IMAGE', imageHash: hash, scaleMode: fill.scale === 'fit' ? 'FIT' : 'FILL' });
      continue;
    }
    // Anything else in the tree is not ours to draw. Ignore it.
  }

  return styleId === undefined ? { paints } : { paints, styleId };
}

export function toStrokes(stroke: Stroke | undefined): { paints: Paint[]; weight: number; align: StrokeAlignment } | null {
  if (!stroke || typeof stroke !== 'object' || typeof stroke.color !== 'string') return null;
  const weight = Number.isFinite(stroke.weight) ? Math.max(0, stroke.weight) : 1;
  if (weight === 0) return null;
  const opacity = clamp01(stroke.opacity === undefined ? hexAlpha(stroke.color) : stroke.opacity);
  const align: StrokeAlignment =
    stroke.align === 'outside' ? 'OUTSIDE' : stroke.align === 'center' ? 'CENTER' : 'INSIDE';
  return { paints: [{ type: 'SOLID', color: hexToRgb(stroke.color), opacity }], weight, align };
}

export function toEffects(effects: Effect[] | undefined): Effect$Figma[] {
  if (!Array.isArray(effects)) return [];
  const out: Effect$Figma[] = [];
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'shadow' || e.type === 'inner-shadow') {
      const rgb = hexToRgb(e.color);
      out.push({
        type: e.type === 'inner-shadow' ? 'INNER_SHADOW' : 'DROP_SHADOW',
        color: { r: rgb.r, g: rgb.g, b: rgb.b, a: clamp01(e.opacity === undefined ? hexAlpha(e.color) : e.opacity) },
        offset: { x: num(e.x), y: num(e.y) },
        radius: Math.max(0, num(e.blur)),
        spread: Math.max(0, num(e.spread)),
        visible: true,
        blendMode: 'NORMAL',
      });
      continue;
    }
    if (e.type === 'blur' || e.type === 'backdrop-blur') {
      out.push({
        type: e.type === 'backdrop-blur' ? 'BACKGROUND_BLUR' : 'LAYER_BLUR',
        blurType: 'NORMAL',
        radius: Math.max(0, num(e.radius)),
        visible: true,
      });
    }
  }
  return out;
}

/** The Figma typings call this `Effect`, which collides with the tree's. */
type Effect$Figma = DropShadowEffect | InnerShadowEffect | BlurEffect;

export function applyRadius(node: SceneNode & { topLeftRadius: number }, radius: Corners | undefined): void {
  if (!Array.isArray(radius) || radius.length !== 4) return;
  const target = node as unknown as {
    topLeftRadius: number;
    topRightRadius: number;
    bottomRightRadius: number;
    bottomLeftRadius: number;
  };
  target.topLeftRadius = Math.max(0, num(radius[0]));
  target.topRightRadius = Math.max(0, num(radius[1]));
  target.bottomRightRadius = Math.max(0, num(radius[2]));
  target.bottomLeftRadius = Math.max(0, num(radius[3]));
}

function num(n: number | undefined): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
