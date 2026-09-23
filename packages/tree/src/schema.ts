import { z } from 'zod';

/**
 * The runtime shape of the design tree.
 *
 * Every object is loose: an unknown field is kept, never fatal, because the
 * plugin's contract is that it ignores what it does not understand. What is
 * checked is that the fields the doc names are there and are the right shape.
 */

const hex6 = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb colour');

const unit = z.number().min(0).max(1);

const quad = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const viewportSchema = z.looseObject({
  w: z.number(),
  h: z.number(),
});

export const placeSchema = z.looseObject({
  x: z.number(),
  y: z.number(),
});

export const sourceSchema = z.looseObject({
  kind: z.enum(['url', 'file']),
  ref: z.string(),
  title: z.string(),
  capturedAt: z.string(),
  viewport: viewportSchema,
});

export const fontFaceSchema = z.looseObject({
  family: z.string(),
  weights: z.array(z.number()),
});

export const assetSchema = z.looseObject({
  type: z.enum(['image', 'svg']),
  mime: z.string(),
  data: z.string(),
  w: z.number(),
  h: z.number(),
});

export const tokenSchema = z.looseObject({
  name: z.string(),
  value: z.string(),
  kind: z.enum(['color', 'number', 'string']),
});

// ---------------------------------------------------------------- layout

export const layoutSchema = z.looseObject({
  mode: z.enum(['row', 'column']),
  gap: z.number(),
  padding: quad,
  align: z.enum(['start', 'center', 'end', 'stretch']),
  justify: z.enum(['start', 'center', 'end', 'space-between']),
  wrap: z.boolean(),
});

const sizingMode = z.enum(['fixed', 'fill', 'hug']);

export const sizingSchema = z.looseObject({
  w: sizingMode,
  h: sizingMode,
});

// ---------------------------------------------------------------- paint

export const solidPaintSchema = z.looseObject({
  type: z.literal('solid'),
  color: hex6,
  opacity: unit,
});

export const gradientStopSchema = z.looseObject({
  at: unit,
  color: hex6,
  opacity: unit,
});

export const linearPaintSchema = z.looseObject({
  type: z.literal('linear'),
  angle: z.number(),
  stops: z.array(gradientStopSchema),
});

export const imagePaintSchema = z.looseObject({
  type: z.literal('image'),
  asset: z.string(),
  scale: z.enum(['fill', 'fit']),
});

export const paintSchema = z.discriminatedUnion('type', [
  solidPaintSchema,
  linearPaintSchema,
  imagePaintSchema,
]);

export const strokeSchema = z.looseObject({
  color: hex6,
  opacity: unit,
  weight: z.number(),
  align: z.enum(['inside', 'center', 'outside']),
});

// ---------------------------------------------------------------- effects

export const shadowEffectSchema = z.looseObject({
  type: z.literal('shadow'),
  x: z.number(),
  y: z.number(),
  blur: z.number(),
  spread: z.number(),
  color: hex6,
  opacity: unit,
});

export const innerShadowEffectSchema = shadowEffectSchema.extend({
  type: z.literal('inner-shadow'),
});

export const blurEffectSchema = z.looseObject({
  type: z.literal('blur'),
  radius: z.number(),
});

export const backdropBlurEffectSchema = z.looseObject({
  type: z.literal('backdrop-blur'),
  radius: z.number(),
});

export const effectSchema = z.discriminatedUnion('type', [
  shadowEffectSchema,
  innerShadowEffectSchema,
  blurEffectSchema,
  backdropBlurEffectSchema,
]);

// ---------------------------------------------------------------- text

export const fontStyleSchema = z.looseObject({
  family: z.string(),
  weight: z.number(),
  style: z.enum(['normal', 'italic']),
  size: z.number(),
  lineHeight: z.number(),
  letterSpacing: z.number(),
});

export const lineBoxSchema = z.looseObject({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const textStyleSchema = z.looseObject({
  content: z.string(),
  font: fontStyleSchema,
  lines: z.number().int().min(1).optional(),
  lineBoxes: z.array(lineBoxSchema).optional(),
  color: hex6,
  opacity: unit,
  align: z.enum(['left', 'center', 'right']),
  decoration: z.enum(['none', 'underline', 'strike']),
  transform: z.enum(['none', 'upper', 'lower']),
});

export const semanticSchema = z.looseObject({
  tag: z.string(),
  classes: z.array(z.string()),
  role: z.string().optional(),
});

// ---------------------------------------------------------------- node

export const nodeSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.enum(['frame', 'text', 'image', 'vector']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  layout: layoutSchema.optional(),
  sizing: sizingSchema.optional(),
  fills: z.array(paintSchema).optional(),
  strokes: strokeSchema.optional(),
  radius: quad.optional(),
  effects: z.array(effectSchema).optional(),
  opacity: unit.optional(),
  clip: z.boolean().optional(),
  flow: z.literal('absolute').optional(),
  text: textStyleSchema.optional(),
  asset: z.string().optional(),
  semantic: semanticSchema.optional(),
  get children() {
    return z.array(nodeSchema).optional();
  },
});

// ---------------------------------------------------------------- the file

export const designTreeSchema = z.looseObject({
  version: z.literal(1),
  source: sourceSchema,
  page: z.string().min(1).optional(),
  section: z.string().min(1).optional(),
  place: placeSchema.optional(),
  fonts: z.array(fontFaceSchema),
  assets: z.record(z.string(), assetSchema),
  tokens: z.array(tokenSchema),
  root: nodeSchema,
});
