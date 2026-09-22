import { extractWithReport, formatWarning } from '@fit-to-figma/extract';
import type { DesignTree } from '@fit-to-figma/tree';

export interface RenderRequest {
  html: string;
  /** Where the HTML came from, for source.ref and for absolute URLs. */
  ref: string;
  kind: 'file' | 'url';
  title: string;
  viewport: { w: number; h: number };
  /** A CSS selector: one frame per match. Blank means the whole page. */
  selector: string;
}

export interface RenderResult {
  trees: DesignTree[];
  warnings: string[];
}

const HIDDEN_FRAME = 'position:fixed;left:-20000px;top:0;border:0;background:#fff;';

/**
 * Renders the HTML in a sandboxed iframe inside the plugin UI at the chosen
 * viewport, waits for fonts and images, and extracts from that document.
 * Scripts do not run: a page that draws itself with JavaScript comes out empty,
 * and the report says so.
 */
export async function treesFromHtml(req: RenderRequest): Promise<RenderResult> {
  const warnings: string[] = [];
  const { frame, doc } = await mountFrame(req, warnings);
  try {
    await settle(doc, warnings);

    const roots = pickRoots(doc, req.selector, warnings);
    const trees: DesignTree[] = [];
    for (const root of roots) {
      const tree = await runExtract(root, req, warnings);
      if (tree) trees.push(tree);
    }
    if (trees.length === 0) warnings.push('Nothing was drawn at this viewport, so no frame was made.');
    return { trees, warnings };
  } finally {
    frame.remove();
  }
}

async function mountFrame(
  req: RenderRequest,
  warnings: string[],
): Promise<{ frame: HTMLIFrameElement; doc: Document }> {
  const html = req.kind === 'url' ? withBase(req.html, req.ref) : req.html;

  const attempt = (sandboxed: boolean): Promise<{ frame: HTMLIFrameElement; doc: Document } | null> =>
    new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('style', HIDDEN_FRAME);
      frame.width = String(req.viewport.w);
      frame.height = String(req.viewport.h);
      if (sandboxed) frame.setAttribute('sandbox', 'allow-same-origin');
      frame.addEventListener('load', () => {
        let doc: Document | null = null;
        try {
          doc = frame.contentDocument;
        } catch {
          doc = null;
        }
        if (!doc || !doc.body) {
          frame.remove();
          resolve(null);
          return;
        }
        resolve({ frame, doc });
      });
      document.body.appendChild(frame);
      frame.srcdoc = html;
    });

  const sandboxed = await attempt(true);
  if (sandboxed) return sandboxed;
  warnings.push('The sandboxed iframe would not open its document, so the page was rendered without the sandbox attribute.');
  const plain = await attempt(false);
  if (plain) return plain;
  throw new Error('The HTML could not be rendered in this plugin window.');
}

/** Relative URLs in fetched HTML have to point back at the page they came from. */
function withBase(html: string, ref: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = '<base href="' + escapeAttr(ref) + '">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, '<head$1>' + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, '<html$1><head>' + tag + '</head>');
  return tag + html;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Fonts loaded, images decoded, one frame painted. */
async function settle(doc: Document, warnings: string[]): Promise<void> {
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && typeof fonts.ready === 'object') {
    await Promise.race([fonts.ready, wait(3000)]);
  }
  const images = Array.from(doc.images);
  const pending = images.filter((img) => !img.complete);
  if (pending.length > 0) {
    await Promise.race([
      Promise.all(
        pending.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
      ),
      wait(5000),
    ]);
  }
  const broken = images.filter((img) => img.complete && img.naturalWidth === 0).length;
  if (broken > 0) warnings.push(broken + ' image(s) did not load and were skipped.');
  await frames(2);
}

function pickRoots(doc: Document, selector: string, warnings: string[]): Element[] {
  const body = doc.body;
  const trimmed = selector.trim();
  if (trimmed === '') return body ? [body] : [];
  let found: Element[] = [];
  try {
    found = Array.from(doc.querySelectorAll(trimmed));
  } catch {
    warnings.push('"' + trimmed + '" is not a CSS selector, so the whole page was used.');
    return body ? [body] : [];
  }
  if (found.length === 0) {
    warnings.push('"' + trimmed + '" matched nothing, so the whole page was used.');
    return body ? [body] : [];
  }
  return found;
}

/** The one place that touches extract's options shape. */
async function runExtract(
  root: Element,
  req: RenderRequest,
  warnings: string[],
): Promise<DesignTree | null> {
  const result = await extractWithReport(root, {
    viewport: req.viewport,
    source: {
      kind: req.kind,
      ref: req.ref,
      title: req.title,
      capturedAt: new Date().toISOString(),
      viewport: req.viewport,
    },
  });
  for (const warning of result.warnings) warnings.push(formatWarning(warning));
  return result.tree ?? null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const step = (): void => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
