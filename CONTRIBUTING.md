# Contributing

## Setup

Node 24.

```
npm install
npm test
npm run typecheck
npm run build -w plugin
```

Then in Figma desktop: Plugins · Development · Import plugin from manifest, and pick `plugin/manifest.json`. After a change, build again and re-run the plugin; Figma reads `plugin/dist` fresh on each run.

## Layout

| Path | Owns |
| --- | --- |
| `docs/DESIGN-TREE.md` | The tree. The one contract both halves are written against. Change it and you change both. |
| `packages/tree` | Types, schema and `validateTree` for the tree. Depends on neither the browser nor Figma. |
| `packages/map` | CSS computed value to tree value. Pure functions: a colour string in, a fill out. Every mapping has a test on a real CSS string. |
| `packages/extract` | Runs inside a browser. Walks the DOM, reads computed style and layout, writes a tree. |
| `plugin` | The Figma plugin. Reads a tree, builds layers. `manifest.json` and `dist/` are what Figma loads. |
| `cli` | Opens a page in a headless browser, runs the extractor, writes the tree to disk. |
| `fixtures` | Pages and the trees they should produce. |

## Adding a mapping

1. Take the real CSS string you want to handle, from a real page. Put it in a test in `packages/map/test` first, with the tree value it should become.
2. Make the test pass in `packages/map/src`.
3. If the tree needs a new field, change `docs/DESIGN-TREE.md` in the same PR and say why. The plugin must ignore a field it does not draw, without error.
4. Draw it in `plugin` if it is drawable.

A mapping with no test on a real string is not merged.

## Reporting a page that comes out wrong

Attach the tree, not the page. Pages move, need logins and are large; the tree is one file and is exactly what the plugin saw.

- CLI: `fit-to-figma <url> -o page.tree.json`, attach `page.tree.json`.
- Plugin: after a run, Save tree from the run's report, attach that.

Say which layer is wrong (its name in Figma or its `id` in the tree) and what it should have been. The page and the Figma result side by side helps.

If the tree is right and Figma is wrong, the bug is in `plugin`. If the tree is wrong, it is in `packages/extract` or `packages/map`. Say which if you can tell.

## Pull requests

- A test on a real CSS string for any mapping change.
- `npm run typecheck` and `npm test` pass.
- `npm run build -w plugin` builds.
- One change per PR.

Plain hyphens in prose. No em or en dashes.
