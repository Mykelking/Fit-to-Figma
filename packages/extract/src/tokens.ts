import type { Token, TokenKind } from '@fit-to-figma/tree';
import { isColorValue } from './style.js';
import type { Warnings } from './warnings.js';

/**
 * Custom properties, from `:root` and from the element the run started at.
 *
 * Two passes, because neither on its own is enough. Stylesheets say which
 * names the page declares, including ones no element ended up using. Computed
 * style says what those names resolved to after the cascade, which is the
 * value the page actually drew with. Names come from the first, values from
 * the second.
 */

const NUMERIC =
  /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|rem|em|%|s|ms|deg|turn|vh|vw|vmin|vmax|ch|ex|pt|fr)?$/i;

export function tokensOf(root: Element, view: Window, warnings: Warnings): Token[] {
  const doc = root.ownerDocument ?? view.document;
  const names = new Set<string>();

  const documentElement = doc.documentElement;
  collectFromStyleSheets(doc, names, warnings);
  collectFromComputed(documentElement, view, names);
  if (root !== documentElement) collectFromComputed(root, view, names);
  collectFromInline(documentElement, names);
  collectFromInline(root, names);

  const rootStyle = safeComputed(view, root);
  const htmlStyle = safeComputed(view, documentElement);

  const tokens: Token[] = [];
  for (const name of Array.from(names).sort()) {
    const value = (
      rootStyle?.getPropertyValue(name) ||
      htmlStyle?.getPropertyValue(name) ||
      ''
    ).trim();
    if (value.length === 0) continue;
    tokens.push({ name, value, kind: kindOf(value) });
  }
  return tokens;
}

export function kindOf(value: string): TokenKind {
  const text = value.trim();
  if (NUMERIC.test(text)) return 'number';
  if (isColorValue(text)) return 'color';
  return 'string';
}

function safeComputed(view: Window, el: Element): CSSStyleDeclaration | null {
  try {
    return view.getComputedStyle(el);
  } catch {
    return null;
  }
}

/** Custom properties declared on `:root` or `html`, wherever they were written. */
function collectFromStyleSheets(doc: Document, names: Set<string>, warnings: Warnings): void {
  const sheets = doc.styleSheets;
  if (!sheets) return;
  for (let i = 0; i < sheets.length; i += 1) {
    const sheet = sheets[i];
    if (!sheet) continue;
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      warnings.add(
        'stylesheet-unreadable',
        'a stylesheet is cross-origin, so the custom properties it declares were not read',
        { detail: sheet.href ?? '(inline)' },
      );
      continue;
    }
    if (rules) walkRules(rules, names);
  }
}

function walkRules(rules: CSSRuleList, names: Set<string>): void {
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule) continue;

    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested && nested.length > 0) walkRules(nested, names);

    const styleRule = rule as CSSStyleRule;
    const selector = styleRule.selectorText;
    if (typeof selector !== 'string') continue;
    if (!/^\s*(?::root|html)\s*(?:,|$)/.test(selector) && !/(^|,)\s*:root\s*(,|$)/.test(selector)) {
      continue;
    }
    const style = styleRule.style;
    if (!style) continue;
    for (let j = 0; j < style.length; j += 1) {
      const name = style.item(j);
      if (name && name.startsWith('--')) names.add(name);
    }
  }
}

/**
 * Chrome lists custom properties in computed style; older engines and test
 * DOMs do not, which is why the stylesheet pass exists.
 */
function collectFromComputed(el: Element, view: Window, names: Set<string>): void {
  const style = safeComputed(view, el);
  if (!style) return;
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name && name.startsWith('--')) names.add(name);
  }
}

function collectFromInline(el: Element, names: Set<string>): void {
  const style = (el as unknown as { style?: CSSStyleDeclaration }).style;
  if (!style) return;
  for (let i = 0; i < style.length; i += 1) {
    const name = style.item(i);
    if (name && name.startsWith('--')) names.add(name);
  }
}
