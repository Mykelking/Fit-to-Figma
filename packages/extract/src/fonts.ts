import type { FontFace, FontStyle } from '@fit-to-figma/tree';

/**
 * The families the page asked for, with the weights it drew at.
 *
 * The family recorded is the first one in the stack, which is the one the page
 * meant, whether or not this machine has it. A face the capturing browser was
 * missing is still the face the design calls for, and naming it is how the
 * plugin can say "Figma does not have this, here is Inter instead" rather than
 * silently recording the fallback as if it were the design.
 */
export class Fonts {
  private readonly weights = new Map<string, Set<number>>();

  seen(font: FontStyle): void {
    let set = this.weights.get(font.family);
    if (!set) {
      set = new Set<number>();
      this.weights.set(font.family, set);
    }
    set.add(font.weight);
  }

  list(): FontFace[] {
    return Array.from(this.weights.entries())
      .map(([family, weights]) => ({
        family,
        weights: Array.from(weights).sort((a, b) => a - b),
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }
}
