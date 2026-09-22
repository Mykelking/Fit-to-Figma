import type { Token } from '@fit-to-figma/tree';
import { hexToRgb, looksLikeColour, normaliseHex } from './colour.js';

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
      const collection = api.createVariableCollection(this.sourceName);
      for (const token of colours) {
        try {
          const variable = api.createVariable(token.name, collection, 'COLOR');
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

  private tryStyles(colours: Token[]): boolean {
    if (typeof figma.createPaintStyle !== 'function') return false;
    try {
      for (const token of colours) {
        const style = figma.createPaintStyle();
        style.name = this.sourceName + '/' + token.name.replace(/^--/, '');
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
      this.bound += 1;
      return { paint, styleId: entry.style.id };
    }
    return { paint };
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
