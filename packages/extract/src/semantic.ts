import type { Semantic } from '@fit-to-figma/tree';

/**
 * What the element was, carried for the plugin's component matching.
 *
 * `semantic` is never needed to draw, so anything extra here is safe: the tree
 * schema keeps unknown fields and the plugin ignores what it does not read.
 */

/** A value that reads like a component name rather than like data. */
const COMPONENT_LIKE = /^[A-Za-z][A-Za-z0-9 _./-]{0,63}$/;

/**
 * `data-` attributes worth keeping even when the value is not name shaped:
 * these are the ones design systems and test suites put component names in.
 */
const ALWAYS_KEEP = new Set([
  'component',
  'testid',
  'test-id',
  'test',
  'cy',
  'qa',
  'name',
  'variant',
  'state',
  'slot',
  'part',
  'block',
  'element',
  'modifier',
]);

export interface SemanticExtras {
  /** Where an image came from when its bytes could not be inlined. */
  src?: string;
}

/** `semantic` for one element. */
export function semanticOf(el: Element, extras?: SemanticExtras): Semantic & {
  data?: Record<string, string>;
  src?: string;
} {
  const tag = el.tagName.toLowerCase();
  const classes = classListOf(el);
  const out: Semantic & { data?: Record<string, string>; src?: string } = { tag, classes };

  const role = el.getAttribute('role') ?? implicitRole(el);
  if (role) out.role = role;

  const data = componentishData(el);
  if (data) out.data = data;

  if (extras?.src) out.src = extras.src;
  return out;
}

function classListOf(el: Element): string[] {
  // SVG elements have a class attribute but an SVGAnimatedString className,
  // so read the attribute rather than the property.
  const raw = el.getAttribute('class');
  if (!raw) return [];
  return raw.split(/\s+/).filter((name) => name.length > 0);
}

function componentishData(el: Element): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let found = false;
  const attributes = el.attributes;
  for (let i = 0; i < attributes.length; i += 1) {
    const attribute = attributes[i];
    if (!attribute) continue;
    const name = attribute.name;
    if (!name.startsWith('data-')) continue;
    const key = name.slice('data-'.length);
    const value = attribute.value;
    if (value.length === 0 || value.length > 64) continue;
    if (!ALWAYS_KEEP.has(key) && !COMPONENT_LIKE.test(value)) continue;
    out[key] = value;
    found = true;
  }
  return found ? out : undefined;
}

/**
 * The role the tag already means. Only the handful the plugin can match on -
 * this is not a full ARIA implicit role table and does not pretend to be.
 */
function implicitRole(el: Element): string | undefined {
  switch (el.tagName.toLowerCase()) {
    case 'button':
      return 'button';
    case 'a':
      return el.hasAttribute('href') ? 'link' : undefined;
    case 'nav':
      return 'navigation';
    case 'header':
      return 'banner';
    case 'footer':
      return 'contentinfo';
    case 'main':
      return 'main';
    case 'aside':
      return 'complementary';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'img':
      return 'img';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'input': {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
      return 'textbox';
    }
    case 'textarea':
      return 'textbox';
    case 'select':
      return 'combobox';
    default:
      return undefined;
  }
}

/** What the layer is called in Figma: `tag.class.class`, trimmed. */
export function nameOf(el: Element, fallback?: string): string {
  const tag = el.tagName.toLowerCase();
  const classes = classListOf(el).slice(0, 3);
  const name = [tag, ...classes].join('.');
  return name.length > 0 ? name : (fallback ?? tag);
}
