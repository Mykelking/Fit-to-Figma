/**
 * A fake Figma just big enough to build a tree against. It keeps the rules the
 * builder has to respect - a font must be loaded before it is set, FILL needs
 * a parent with auto layout, HUG needs auto layout or text - so a test can
 * catch the builder breaking them.
 */

export interface FakeOptions {
  /** Families and styles this file has. Anything else rejects. */
  fonts?: Record<string, string[]>;
  /** false turns the variables API off so the builder falls back to styles. */
  variables?: boolean;
  /** false turns paint styles off too. */
  paintStyles?: boolean;
  /** Node ids that throw when created, to exercise skip and continue. */
  breakOn?: (kind: string, made: number) => boolean;
}

let uid = 0;
const nextId = (): string => 'fig' + ++uid;

export class FakeNode {
  readonly id = nextId();
  type = 'NODE';
  name = '';
  x = 0;
  y = 0;
  width = 100;
  height = 100;
  opacity = 1;
  visible = true;
  fills: unknown[] = [];
  fillStyleId = '';
  strokes: unknown[] = [];
  strokeWeight = 1;
  strokeAlign = 'INSIDE';
  effects: unknown[] = [];
  topLeftRadius = 0;
  topRightRadius = 0;
  bottomRightRadius = 0;
  bottomLeftRadius = 0;
  parent: FakeContainer | null = null;
  layoutSizingHorizontalValue: string | null = null;
  layoutSizingVerticalValue: string | null = null;
  removed = false;
  private readonly plugin = new Map<string, string>();

  constructor(readonly file: FakeFile) {
    file.byId.set(this.id, this);
  }

  resize(w: number, h: number): void {
    if (!(w > 0) || !(h > 0)) throw new Error('resize needs positive numbers');
    this.width = w;
    this.height = h;
  }

  setPluginData(key: string, value: string): void {
    this.plugin.set(key, value);
  }

  getPluginData(key: string): string {
    return this.plugin.get(key) ?? '';
  }

  remove(): void {
    this.removed = true;
    if (this.parent) {
      const i = this.parent.children.indexOf(this);
      if (i >= 0) this.parent.children.splice(i, 1);
      this.parent = null;
    }
  }

  get layoutSizingHorizontal(): string {
    return this.layoutSizingHorizontalValue ?? 'FIXED';
  }

  set layoutSizingHorizontal(mode: string) {
    this.checkSizing(mode);
    this.layoutSizingHorizontalValue = mode;
  }

  get layoutSizingVertical(): string {
    return this.layoutSizingVerticalValue ?? 'FIXED';
  }

  set layoutSizingVertical(mode: string) {
    this.checkSizing(mode);
    this.layoutSizingVerticalValue = mode;
  }

  protected checkSizing(mode: string): void {
    const parent = this.parent as FakeFrame | null;
    if (mode === 'FILL' && (!parent || parent.layoutMode === 'NONE')) {
      throw new Error('FILL needs a parent with auto layout');
    }
    if (mode === 'HUG' && this.type !== 'TEXT' && (this as unknown as FakeFrame).layoutMode === undefined) {
      throw new Error('HUG needs auto layout');
    }
    if (mode === 'HUG' && this.type === 'FRAME' && (this as unknown as FakeFrame).layoutMode === 'NONE') {
      throw new Error('HUG needs auto layout');
    }
  }
}

export class FakeContainer extends FakeNode {
  children: FakeNode[] = [];

  appendChild(child: FakeNode): void {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
  }

  insertChild(index: number, child: FakeNode): void {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.splice(index, 0, child);
  }

  findOne(match: (n: FakeNode) => boolean): FakeNode | null {
    for (const child of this.children) {
      if (match(child)) return child;
      if (child instanceof FakeContainer) {
        const deeper = child.findOne(match);
        if (deeper) return deeper;
      }
    }
    return null;
  }

  findAll(match: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = [];
    for (const child of this.children) {
      if (match(child)) out.push(child);
      if (child instanceof FakeContainer) out.push(...child.findAll(match));
    }
    return out;
  }
}

export class FakeFrame extends FakeContainer {
  override type = 'FRAME';
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL' = 'NONE';
  itemSpacing = 0;
  paddingTop = 0;
  paddingRight = 0;
  paddingBottom = 0;
  paddingLeft = 0;
  primaryAxisAlignItems = 'MIN';
  counterAxisAlignItems = 'MIN';
  layoutWrap = 'NO_WRAP';
  clipsContent = false;
  /** Set when the frame came out of createNodeFromSvg. */
  svg: string | null = null;
}

export class FakeRectangle extends FakeNode {
  override type = 'RECTANGLE';
}

export class FakeText extends FakeNode {
  override type = 'TEXT';
  private fontValue: { family: string; style: string } = { family: 'Inter', style: 'Regular' };
  private charsValue = '';
  fontSize = 12;
  lineHeight: unknown = { unit: 'AUTO' };
  letterSpacing: unknown = { unit: 'PIXELS', value: 0 };
  textAlignHorizontal = 'LEFT';
  textDecoration = 'NONE';
  private autoResize = 'WIDTH_AND_HEIGHT';

  constructor(
    file: FakeFile,
    private readonly isLoaded: (font: { family: string; style: string }) => boolean,
  ) {
    super(file);
  }

  get fontName(): { family: string; style: string } {
    return this.fontValue;
  }

  set fontName(font: { family: string; style: string }) {
    if (!this.isLoaded(font)) {
      throw new Error('font ' + font.family + ' ' + font.style + ' is not loaded');
    }
    this.fontValue = font;
  }

  get characters(): string {
    return this.charsValue;
  }

  set characters(value: string) {
    if (!this.isLoaded(this.fontValue)) {
      throw new Error('font ' + this.fontValue.family + ' is not loaded');
    }
    this.charsValue = value;
    this.layOut();
  }

  get textAutoResize(): string {
    return this.autoResize;
  }

  set textAutoResize(mode: string) {
    this.autoResize = mode;
    this.layOut();
  }

  override resize(w: number, h: number): void {
    super.resize(w, h);
    this.layOut();
  }

  /** Metrics crude enough to be wrong, exact enough to tell wrapping apart. */
  private layOut(): void {
    if (this.autoResize === 'NONE') return;
    const line = this.lineHeightPx();
    const run = Math.max(1, this.charsValue.length * this.fontSize * 0.5);
    if (this.autoResize === 'WIDTH_AND_HEIGHT') {
      this.width = run;
      this.height = line;
      return;
    }
    // HEIGHT: the width stands and the text takes as many lines as it needs.
    this.height = Math.ceil(run / Math.max(1, this.width)) * line;
  }

  private lineHeightPx(): number {
    const set = this.lineHeight as { unit?: string; value?: number };
    return set && set.unit === 'PIXELS' && typeof set.value === 'number' ? set.value : this.fontSize * 1.2;
  }
}

export class FakePage extends FakeContainer {
  override type = 'PAGE';
  private selected: FakeNode[] = [];

  get selection(): FakeNode[] {
    return this.selected;
  }

  /** Figma refuses a selection that is not on this page, and so does the fake. */
  set selection(nodes: FakeNode[]) {
    for (const node of nodes) {
      if (pageOf(node) !== this) throw new Error('a node on another page cannot be selected');
    }
    this.selected = nodes;
  }
}

function pageOf(node: FakeNode): FakePage | null {
  let at: FakeNode | null = node;
  while (at) {
    if (at instanceof FakePage) return at;
    at = at.parent;
  }
  return null;
}

export interface FakeVariable {
  id: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, unknown>;
  setValueForMode(modeId: string, value: unknown): void;
}

export interface FakeCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  variables: FakeVariable[];
}

export class FakeFile {
  readonly byId = new Map<string, FakeNode>();
  readonly page = new FakePage(this);
  /** Every page in the file, the first one being the one a run starts on. */
  readonly pages: FakePage[] = [this.page];
  readonly loadedFonts: Array<{ family: string; style: string }> = [];
  readonly images: Array<{ hash: string; bytes: Uint8Array }> = [];
  readonly collections: FakeCollection[] = [];
  readonly paintStyles: Array<{ id: string; name: string; paints: unknown[] }> = [];
  readonly available: Record<string, string[]>;
  made = 0;

  constructor(readonly options: FakeOptions = {}) {
    this.page.name = 'Page 1';
    this.available = options.fonts ?? {
      Inter: ['Thin', 'Light', 'Regular', 'Medium', 'Semi Bold', 'Bold', 'Black', 'Italic', 'Bold Italic'],
    };
  }

  has(font: { family: string; style: string }): boolean {
    const styles = this.available[font.family];
    return Array.isArray(styles) && styles.includes(font.style);
  }

  isLoaded(font: { family: string; style: string }): boolean {
    return this.loadedFonts.some((f) => f.family === font.family && f.style === font.style);
  }

  private breakIfAsked(kind: string): void {
    this.made += 1;
    if (this.options.breakOn?.(kind, this.made)) throw new Error('the fake refused to make a ' + kind);
  }

  build(): typeof figma {
    const file = this;
    const variablesApi = {
      createVariableCollection(name: string): FakeCollection {
        const collection: FakeCollection = {
          id: nextId(),
          name,
          modes: [{ modeId: 'mode1', name: 'Mode 1' }],
          variables: [],
        };
        file.collections.push(collection);
        return collection;
      },
      createVariable(name: string, collection: FakeCollection, resolvedType: string): FakeVariable {
        const variable: FakeVariable = {
          id: nextId(),
          name,
          resolvedType,
          valuesByMode: {},
          setValueForMode(modeId: string, value: unknown) {
            this.valuesByMode[modeId] = value;
          },
        };
        collection.variables.push(variable);
        return variable;
      },
      setBoundVariableForPaint(paint: Record<string, unknown>, field: string, variable: FakeVariable): unknown {
        return {
          ...paint,
          boundVariables: { [field]: { type: 'VARIABLE_ALIAS', id: variable.id } },
        };
      },
    };

    let current = file.page;
    const api = {
      root: { children: file.pages },
      get currentPage(): FakePage {
        return current;
      },
      set currentPage(page: FakePage) {
        current = page;
      },
      viewport: {
        center: { x: 0, y: 0 },
        scrollAndZoomIntoView(nodes: FakeNode[]): void {
          // Figma throws on a node that is not on the page you are looking at.
          for (const node of nodes) {
            if (pageOf(node) !== current) throw new Error('that node is on another page');
          }
        },
      },
      createPage(): FakePage {
        const made = new FakePage(file);
        made.name = 'Page ' + (file.pages.length + 1);
        file.pages.push(made);
        return made;
      },
      createFrame(): FakeFrame {
        file.breakIfAsked('frame');
        return new FakeFrame(file);
      },
      createRectangle(): FakeRectangle {
        file.breakIfAsked('rectangle');
        return new FakeRectangle(file);
      },
      createText(): FakeText {
        file.breakIfAsked('text');
        return new FakeText(file, (font) => file.isLoaded(font));
      },
      createImage(bytes: Uint8Array): { hash: string } {
        file.breakIfAsked('image');
        if (!bytes || bytes.length === 0) throw new Error('empty image');
        const made = { hash: 'img' + (file.images.length + 1), bytes };
        file.images.push(made);
        return made;
      },
      createNodeFromSvg(svg: string): FakeFrame {
        file.breakIfAsked('svg');
        if (typeof svg !== 'string' || svg.indexOf('<svg') < 0) throw new Error('not svg');
        const frame = new FakeFrame(file);
        frame.svg = svg;
        return frame;
      },
      async loadFontAsync(font: { family: string; style: string }): Promise<void> {
        if (!file.has(font)) throw new Error('font not found: ' + font.family + ' ' + font.style);
        if (!file.isLoaded(font)) file.loadedFonts.push(font);
      },
      getNodeById(id: string): FakeNode | null {
        return file.byId.get(id) ?? null;
      },
      showUI(): void {
        /* no window in a fake */
      },
      closePlugin(): void {
        /* nothing to close */
      },
      ui: {
        postMessage(): void {
          /* nothing listening */
        },
        onmessage: null,
        resize(): void {
          /* no window */
        },
      },
      variables: file.options.variables === false ? undefined : variablesApi,
      createPaintStyle:
        file.options.paintStyles === false
          ? undefined
          : (): { id: string; name: string; paints: unknown[] } => {
              const style = { id: nextId(), name: '', paints: [] as unknown[] };
              file.paintStyles.push(style);
              return style;
            },
    };
    return api as unknown as typeof figma;
  }
}

/** Installs a fake on globalThis and hands back the file to assert against. */
export function installFigma(options: FakeOptions = {}): FakeFile {
  const file = new FakeFile(options);
  (globalThis as unknown as { figma: typeof figma }).figma = file.build();
  return file;
}
