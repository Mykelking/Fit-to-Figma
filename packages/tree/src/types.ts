/**
 * The design tree, version 1, exactly as docs/DESIGN-TREE.md gives it.
 *
 * Positions are CSS pixels, absolute, relative to the root frame.
 * Colours are '#rrggbb'; alpha always travels beside them as `opacity`.
 *
 * Unknown fields are allowed on every object: the plugin ignores what it does
 * not understand, never fatally. The schema keeps them at runtime, so a tree
 * that came through `validateTree` can carry more than these types name.
 */

// ---------------------------------------------------------------- the file

export interface DesignTree {
  version: 1;
  source: Source;
  fonts: FontFace[];
  assets: Record<string, Asset>;
  tokens: Token[];
  root: Node;
}

export interface Source {
  kind: 'url' | 'file';
  /** The URL captured, or the path of the HTML file. */
  ref: string;
  title: string;
  /** RFC 3339. */
  capturedAt: string;
  viewport: Viewport;
}

export interface Viewport {
  w: number;
  h: number;
}

/** One family the page used, with every weight it drew in. */
export interface FontFace {
  family: string;
  weights: number[];
}

export interface Asset {
  type: 'image' | 'svg';
  /** 'image/png', 'image/svg+xml', … */
  mime: string;
  /** base64 for an image, SVG markup for a vector. */
  data: string;
  w: number;
  h: number;
}

export type TokenKind = 'color' | 'number' | 'string';

/**
 * A custom property lifted off the page. `value` is always the string the page
 * held; `kind` says how to read it.
 */
export interface Token {
  name: string;
  value: string;
  kind: TokenKind;
}

// ---------------------------------------------------------------- the node

export type NodeType = 'frame' | 'text' | 'image' | 'vector';

export interface Node {
  id: string;
  /** What the layer is called in Figma. */
  name: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Frames only. Absent means no auto layout: children are placed absolutely. */
  layout?: Layout;
  sizing?: Sizing;
  fills?: Paint[];
  strokes?: Stroke;
  /** tl, tr, br, bl. */
  radius?: Corners;
  effects?: Effect[];
  opacity?: number;
  clip?: boolean;
  /** Text nodes only. */
  text?: TextStyle;
  /** Image and vector nodes only: a key into `assets`. */
  asset?: string;
  semantic?: Semantic;
  /** Frames only, in paint order. */
  children?: Node[];
}

/** Four numbers, in CSS order. */
export type Quad = [number, number, number, number];
/** top, right, bottom, left. */
export type Padding = Quad;
/** tl, tr, br, bl. */
export type Corners = Quad;

// ---------------------------------------------------------------- layout

export type LayoutMode = 'row' | 'column';
export type LayoutAlign = 'start' | 'center' | 'end' | 'stretch';
export type LayoutJustify = 'start' | 'center' | 'end' | 'space-between';

export interface Layout {
  mode: LayoutMode;
  gap: number;
  padding: Padding;
  /** Cross axis. */
  align: LayoutAlign;
  /** Main axis. */
  justify: LayoutJustify;
  wrap: boolean;
}

export type SizingMode = 'fixed' | 'fill' | 'hug';

export interface Sizing {
  w: SizingMode;
  h: SizingMode;
}

// ---------------------------------------------------------------- paint

export interface SolidPaint {
  type: 'solid';
  color: string;
  opacity: number;
}

/** Position along the gradient line, 0 at the start and 1 at the end. */
export interface GradientStop {
  at: number;
  color: string;
  opacity: number;
}

export interface LinearPaint {
  type: 'linear';
  /** Degrees clockwise from "to top", the same reading as CSS: 90 points right. */
  angle: number;
  stops: GradientStop[];
}

export interface ImagePaint {
  type: 'image';
  /** A key into `assets`. */
  asset: string;
  scale: 'fill' | 'fit';
}

export type Paint = SolidPaint | LinearPaint | ImagePaint;

export interface Stroke {
  color: string;
  opacity: number;
  weight: number;
  align: 'inside' | 'center' | 'outside';
}

// ---------------------------------------------------------------- effects

export interface ShadowEffect {
  /** 'shadow' is a drop shadow; 'inner-shadow' is CSS `inset`. */
  type: 'shadow' | 'inner-shadow';
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
}

export interface BlurEffect {
  type: 'blur' | 'backdrop-blur';
  radius: number;
}

export type Effect = ShadowEffect | BlurEffect;

// ---------------------------------------------------------------- text

export type FontStyleName = 'normal' | 'italic';

export interface FontStyle {
  family: string;
  weight: number;
  style: FontStyleName;
  size: number;
  /** Always resolved to pixels. */
  lineHeight: number;
  /** Always resolved to pixels. */
  letterSpacing: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextDecoration = 'none' | 'underline' | 'strike';
export type TextTransform = 'none' | 'upper' | 'lower';

export interface TextStyle {
  content: string;
  font: FontStyle;
  color: string;
  opacity: number;
  align: TextAlign;
  decoration: TextDecoration;
  transform: TextTransform;
}

// ---------------------------------------------------------------- semantic

/** Carried for the plugin's component matching. Never needed to draw. */
export interface Semantic {
  tag: string;
  classes: string[];
  role?: string;
}
