import type { Token } from '@fit-to-figma/tree';
import { clamp01, hexAlpha, hexToRgb, looksLikeColour, normaliseHex } from './colour.js';

export type TokenTarget = 'variables' | 'styles' | 'none';

interface ColourEntry {
  variable?: Variable;
  style?: PaintStyle;
}

/**
 * Colour tokens become variables in one collection with one mode, named after
 * the source. When the file has no variables API, paint styles stand in. When
 * neither works the run carries on and the report says so.
 */
export class TokenStore {
  target: TokenTarget = 'none';
  bound = 0;
  readonly warnings: string[] = [];
  private readonly byColour = new Map<string, ColourEntry>();

  constructor(
    private readonly sourceName: string,
    private readonly tokens: Token[],
  ) {}

  /** Call once before building. Safe to call with variables unavailable. */
  init(wanted: boolean): void {
    const colours = this.tokens.filter((t) => t.kind === 'color' && looksLikeColour(t.value));
    if (!wanted || colours.length === 0) {
      this.target = 'none';
      return;
    }
    if (this.tryVariables(colours)) return;
    if (this.tryStyles(colours)) return;
    this.target = 'none';
  }

  private tryVariables(colours: Token[]): boolean {
    const api = figma.variables as typeof figma.variables | undefined;
    if (!api || typeof api.createVariableCollection !== 'function') return false;
    try {
      const collection = this.collectionNamed(api) ?? api.createVariableCollection(this.sourceName);
      const already = this.variablesIn(api, collection);
      for (const token of colours) {
        try {
          const variable = already.get(token.name) ?? api.createVariable(token.name, collection, 'COLOR');
          const mode = collection.modes[0];
          if (mode) variable.setValueForMode(mode.modeId, hexToRgb(token.value));
          this.byColour.set(normaliseHex(token.value), { variable });
        } catch (err) {
          this.warnings.push('token ' + token.name + ': ' + message(err));
        }
      }
      this.target = 'variables';
      return this.byColour.size > 0;
    } catch {
      return false;
    }
  }

  /** A run per file still writes one collection: the name is looked up first. */
  private collectionNamed(api: typeof figma.variables): VariableCollection | null {
    const list = (api as { getLocalVariableCollections?: () => VariableCollection[] })
      .getLocalVariableCollections;
    if (typeof list !== 'function') return null;
    try {
      for (const collection of list.call(api)) {
        if (collection.name === this.sourceName) return collection;
      }
    } catch {
      // A file that will not list its collections gets a new one.
    }
    return null;
  }

  /** What that collection already holds, by name, so a second file adds to it. */
  private variablesIn(api: typeof figma.variables, collection: VariableCollection): Map<string, Variable> {
    const out = new Map<string, Variable>();
    const get = (api as { getVariableById?: (id: string) => Variable | null }).getVariableById;
    if (typeof get !== 'function') return out;
    try {
      for (const id of collection.variableIds ?? []) {
        const variable = get.call(api, id);
        if (variable) out.set(variable.name, variable);
      }
    } catch {
      // Same again: what cannot be read is made afresh.
    }
    return out;
  }

  private tryStyles(colours: Token[]): boolean {
    if (typeof figma.createPaintStyle !== 'function') return false;
    try {
      const already = this.stylesByName();
      for (const token of colours) {
        const name = this.sourceName + '/' + token.name.replace(/^--/, '');
        const style = already.get(name) ?? figma.createPaintStyle();
        style.name = name;
        style.paints = [{ type: 'SOLID', color: hexToRgb(token.value) }];
        this.byColour.set(normaliseHex(token.value), { style });
      }
      this.target = 'styles';
      this.warnings.push('This file has no variables, so colour tokens became paint styles.');
      return this.byColour.size > 0;
    } catch {
      return false;
    }
  }

  /** The styles this file already has, so a second file rewrites them. */
  private stylesByName(): Map<string, PaintStyle> {
    const out = new Map<string, PaintStyle>();
    const list = (figma as { getLocalPaintStyles?: () => PaintStyle[] }).getLocalPaintStyles;
    if (typeof list !== 'function') return out;
    try {
      for (const style of list.call(figma)) out.set(style.name, style);
    } catch {
      // A file that will not list its styles gets new ones.
    }
    return out;
  }

  /**
   * Binds a solid paint to the token that carries the same colour. Returns the
   * paint to use; when a paint style took the binding instead it also returns
   * the style id for the caller to set.
   */
  bind(paint: SolidPaint, hex: string): { paint: Paint; styleId?: string } {
    const entry = this.byColour.get(normaliseHex(hex));
    if (!entry) return { paint };
    if (entry.variable) {
      try {
        const api = figma.variables;
        if (api && typeof api.setBoundVariableForPaint === 'function') {
          const bound = api.setBoundVariableForPaint(paint, 'color', entry.variable);
          this.bound += 1;
          return { paint: bound };
        }
      } catch {
        // fall through to the plain paint
      }
      return { paint };
    }
    if (entry.style) {
      // A paint style replaces the layer's paint outright, opacity with it, so
      // a scrim bound to one would come out solid. There the colour stays
      // literal. A variable binds the colour alone and keeps the opacity.
      if (clamp01(paint.opacity === undefined ? 1 : paint.opacity) < 1) return { paint };
      if (hexAlpha(hex) < 1) return { paint };
      this.bound += 1;
      return { paint, styleId: entry.style.id };
    }
    return { paint };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
