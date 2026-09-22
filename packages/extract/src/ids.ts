/**
 * Deterministic ids.
 *
 * An id is a hash of where the node sits in the DOM, counted from the root the
 * run started at. The same page extracted twice gives the same ids, so the
 * plugin can update frames in place on a second run. Nothing about the id
 * depends on the order things were visited, on time, or on a counter.
 *
 * The path of an element is its chain of `tag:index` steps, where index counts
 * element siblings of the same position, e.g. `div:0/ul:1/li:2/p:0`. Nodes the
 * DOM has no element for - a text run inside a mixed paragraph, a `::before` -
 * hang off their element's path with a suffix.
 */

/** FNV-1a, 32 bit, as base 36. Short, stable, and no dependency. */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash * 16777619 without overflowing a double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

/**
 * Hands out ids, and keeps them unique.
 *
 * Two nodes can share a path - a `<p>` that becomes a frame with one text child
 * covering the same element, say - so the suffix is part of the path, and if a
 * path still repeats it is disambiguated by how many times it has been seen.
 * That count is deterministic because the walk order is.
 */
export class Ids {
  private readonly taken = new Set<string>();
  private readonly seen = new Map<string, number>();

  /** An id for `path`, unique within this run. */
  take(path: string): string {
    const seenBefore = this.seen.get(path) ?? 0;
    this.seen.set(path, seenBefore + 1);
    let key = seenBefore === 0 ? path : `${path}~${seenBefore}`;
    let id = `n${hashString(key)}`;
    // Two different paths hashing the same is vanishingly unlikely, but an id
    // collision would silently merge two layers on a re-run, so close the door.
    let bump = 0;
    while (this.taken.has(id)) {
      bump += 1;
      key = `${key}!${bump}`;
      id = `n${hashString(key)}`;
    }
    this.taken.add(id);
    return id;
  }
}
