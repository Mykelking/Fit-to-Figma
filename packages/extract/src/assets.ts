import type { Asset } from '@fit-to-figma/tree';
import { hashString } from './ids.js';
import type { Warnings } from './warnings.js';

/**
 * The asset table.
 *
 * Bytes are inlined when the browser will hand them over: a same-origin file,
 * or a cross-origin one the server allows with CORS. When it will not, the
 * caller gets `null`, puts the URL in `semantic` and draws a placeholder, and
 * a warning says which URL it was. Nothing here throws.
 *
 * Ids are a hash of the asset's own bytes, so the same picture used in ten
 * places is one entry, and a second run of the same page gives the same ids.
 */

export interface AssetRef {
  id: string;
  w: number;
  h: number;
}

/** A pixel size we can fall back on when the real one is not readable. */
export interface SizeHint {
  w: number;
  h: number;
}

export class Assets {
  private readonly table: Record<string, Asset> = {};
  /** URL to the id it produced, or null when it could not be inlined. */
  private readonly bySource = new Map<string, AssetRef | null>();
  private used = 0;

  constructor(
    private readonly budgetBytes: number,
    private readonly warnings: Warnings,
  ) {}

  get bytes(): number {
    return this.used;
  }

  get all(): Record<string, Asset> {
    return this.table;
  }

  /** SVG markup, already serialised and already resolved. Never fails. */
  addSvg(markup: string, size: SizeHint): AssetRef | null {
    const bytes = markup.length;
    const id = `a${hashString(markup)}`;
    const existing = this.table[id];
    if (existing) return { id, w: existing.w, h: existing.h };
    if (!this.afford(bytes, 'inline svg')) return null;
    this.table[id] = {
      type: 'svg',
      mime: 'image/svg+xml',
      data: markup,
      w: round(size.w),
      h: round(size.h),
    };
    return { id, w: round(size.w), h: round(size.h) };
  }

  /** Raw bytes we already hold, e.g. a canvas readback. */
  addBase64(base64: string, mime: string, size: SizeHint): AssetRef | null {
    const id = `a${hashString(`${mime}:${base64}`)}`;
    const existing = this.table[id];
    if (existing) return { id, w: existing.w, h: existing.h };
    if (!this.afford(base64Bytes(base64), mime)) return null;
    this.table[id] = {
      type: 'image',
      mime,
      data: base64,
      w: round(size.w),
      h: round(size.h),
    };
    return { id, w: round(size.w), h: round(size.h) };
  }

  /**
   * Fetch a URL and inline it. Returns null when the bytes are not reachable -
   * a cross-origin server without CORS, a 404, or the budget already spent.
   */
  async addUrl(url: string, hint: SizeHint, nodeId?: string): Promise<AssetRef | null> {
    const cached = this.bySource.get(url);
    if (cached !== undefined) return cached;

    let ref: AssetRef | null = null;
    try {
      ref = await this.load(url, hint);
    } catch (error) {
      ref = null;
      this.warnings.add(
        'asset-fetch-failed',
        'image could not be read from the page, its URL is in semantic.src and the fill is a placeholder',
        { detail: `${shortUrl(url)}: ${(error as Error).message}`, ...(nodeId ? { node: nodeId } : {}) },
      );
    }
    this.bySource.set(url, ref);
    return ref;
  }

  private async load(url: string, hint: SizeHint): Promise<AssetRef | null> {
    if (url.startsWith('data:')) {
      const parsed = parseDataUrl(url);
      if (!parsed) throw new Error('unreadable data URL');
      if (parsed.mime === 'image/svg+xml') {
        return this.addSvg(parsed.text ?? atobSafe(parsed.base64), await this.sizeOf(url, hint));
      }
      return this.addBase64(parsed.base64, parsed.mime, await this.sizeOf(url, hint));
    }

    const response = await fetch(url, { credentials: 'include', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const mime = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() || mimeFromUrl(url);

    if (mime === 'image/svg+xml') {
      const markup = await response.text();
      return this.addSvg(markup, await this.sizeOf(url, hint));
    }

    const buffer = await response.arrayBuffer();
    if (!this.afford(buffer.byteLength, mime)) return null;
    const size = await measureBlob(buffer, mime, hint);
    return this.addBase64(toBase64(buffer), mime, size);
  }

  private async sizeOf(url: string, hint: SizeHint): Promise<SizeHint> {
    const measured = await measureUrl(url);
    return measured ?? hint;
  }

  /** Is there budget left? Says so once when there is not. */
  private afford(bytes: number, what: string): boolean {
    if (this.used + bytes <= this.budgetBytes) {
      this.used += bytes;
      return true;
    }
    this.warnings.add(
      'asset-budget-exceeded',
      `the asset budget of ${this.budgetBytes} bytes is spent, later images are placeholders`,
      { detail: what },
    );
    return false;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** base64 characters to bytes, near enough for a budget. */
function base64Bytes(base64: string): number {
  return Math.floor((base64.length * 3) / 4);
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In chunks: String.fromCharCode.apply blows the argument limit on big files.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function atobSafe(base64: string): string {
  try {
    return decodeURIComponent(escape(atob(base64)));
  } catch {
    return atob(base64);
  }
}

export function parseDataUrl(
  url: string,
): { mime: string; base64: string; text?: string } | null {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const head = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const isBase64 = /;base64$/i.test(head);
  const mime = head.replace(/;base64$/i, '').split(';')[0] || 'text/plain';
  if (isBase64) return { mime, base64: body };
  const text = decodeURIComponent(body);
  return { mime, base64: btoa(unescape(encodeURIComponent(text))), text };
}

function mimeFromUrl(url: string): string {
  const clean = url.split('?')[0]?.split('#')[0] ?? url;
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

function shortUrl(url: string): string {
  return url.length > 120 ? `${url.slice(0, 117)}...` : url;
}

/** The picture's own pixel size, when the browser will tell us. */
async function measureBlob(
  buffer: ArrayBuffer,
  mime: string,
  hint: SizeHint,
): Promise<SizeHint> {
  if (typeof createImageBitmap !== 'function' || typeof Blob !== 'function') return hint;
  try {
    const bitmap = await createImageBitmap(new Blob([buffer], { type: mime }));
    const size = { w: bitmap.width, h: bitmap.height };
    bitmap.close?.();
    return size.w > 0 && size.h > 0 ? size : hint;
  } catch {
    return hint;
  }
}

async function measureUrl(url: string): Promise<SizeHint | null> {
  if (typeof Image !== 'function') return null;
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      return { w: image.naturalWidth, h: image.naturalHeight };
    }
    return null;
  } catch {
    return null;
  }
}
