import type { DesignTree } from '@fit-to-figma/tree';

export interface BuildOptions {
  /** Bind a solid colour that equals a colour token to a Figma variable. */
  bindVariables: boolean;
  /** Replace a frame whose pluginData.fitId matches, in place. */
  updateById: boolean;
  /** Nodes made between yields to the event loop. */
  batchSize?: number;
  /** The variable collection tokens go into. Unset names it after the source. */
  collection?: string;
}

/** Which file of a many file drop this message is about. Unset means the only one. */
export interface Batch {
  index: number;
  total: number;
}

export interface BuildReport {
  nodes: number;
  frames: number;
  texts: number;
  images: number;
  vectors: number;
  framesCreated: number;
  framesUpdated: number;
  /** Families Figma did not have; each fell back to Inter and is listed once. */
  fontsMissing: string[];
  assetsSkipped: number;
  /** 'variables' | 'styles' | 'none' - where colour tokens ended up. */
  tokens: 'variables' | 'styles' | 'none';
  tokensBound: number;
  warnings: string[];
}

export type UiToMain =
  | { type: 'build'; trees: DesignTree[]; options: BuildOptions; batch?: Batch }
  | { type: 'cancel' }
  | { type: 'close' }
  | { type: 'resize'; height: number };

export type MainToUi =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'done'; report: BuildReport; batch?: Batch }
  | { type: 'failed'; message: string };

export function emptyReport(): BuildReport {
  return {
    nodes: 0,
    frames: 0,
    texts: 0,
    images: 0,
    vectors: 0,
    framesCreated: 0,
    framesUpdated: 0,
    fontsMissing: [],
    assetsSkipped: 0,
    tokens: 'none',
    tokensBound: 0,
    warnings: [],
  };
}
