import type { Asset } from '@fit-to-figma/tree';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Figma's sandbox has no atob, and not every build has figma.base64Decode. */
export function decodeBase64(input: string): Uint8Array {
  const api = (figma as unknown as { base64Decode?: (s: string) => Uint8Array }).base64Decode;
  const clean = input.replace(/^data:[^,]*,/, '').replace(/[\r\n\s]/g, '');
  if (typeof api === 'function') return api(clean);

  const body = clean.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let at = 0;
  for (const ch of body) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at++] = (acc >> bits) & 0xff;
    }
  }
  return at === out.length ? out : out.slice(0, at);
}

/** One Figma image per asset, however many nodes paint with it. */
export class AssetStore {
  private readonly images = new Map<string, string>();
  private readonly bad = new Set<string>();
  skipped = 0;

  constructor(private readonly assets: Record<string, Asset>) {}

  get(id: string): Asset | undefined {
    return this.assets[id];
  }

  /** The image hash for an asset, or null when it cannot be read. */
  imageHash(id: string): string | null {
    const known = this.images.get(id);
    if (known !== undefined) return known;
    if (this.bad.has(id)) return null;

    const asset = this.assets[id];
    if (!asset || asset.type !== 'image' || typeof asset.data !== 'string') {
      this.bad.add(id);
      this.skipped += 1;
      return null;
    }
    try {
      const image = figma.createImage(decodeBase64(asset.data));
      this.images.set(id, image.hash);
      return image.hash;
    } catch {
      this.bad.add(id);
      this.skipped += 1;
      return null;
    }
  }

  svg(id: string): string | null {
    const asset = this.assets[id];
    if (!asset || asset.type !== 'svg' || typeof asset.data !== 'string' || asset.data === '') {
      this.bad.add(id);
      this.skipped += 1;
      return null;
    }
    return asset.data;
  }
}
