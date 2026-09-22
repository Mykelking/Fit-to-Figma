# How it works

## The tree

One JSON file. A root frame, nodes inside it, each with a box, a layout, fills, strokes, radius, effects, text or an asset, and a stable `id`. Fonts, assets and CSS custom properties sit at the top. The whole thing is specified in [DESIGN-TREE.md](DESIGN-TREE.md), and `packages/tree` holds the types and a validator.

Positions are absolute, in CSS pixels, relative to the root. Nothing in the tree says how it was captured; a tree from the CLI and a tree from pasted HTML look the same.

## The extractor

`packages/extract` runs inside a browser, against a page that has already laid itself out. For each element it reads the rendered box (`getBoundingClientRect`) and the computed style, not the stylesheet. `packages/map` turns each computed value into a tree value: a colour string into a fill, a `box-shadow` string into an effect, a flex container into a `layout`. Text becomes one node per run, in the font the browser actually used. Inline SVG and images become assets. Hidden and empty elements are dropped.

Reading the layout instead of the stylesheet is why it matches the page: percentages, `calc()`, media queries, flex-grow and font fallbacks have all been resolved by the browser already. The extractor never has to reimplement CSS.

The CLI is the extractor in a headless browser, with a file written at the end. The plugin's paste-HTML and URL paths are the same extractor in the plugin's own iframe.

## The plugin

`plugin` reads a tree and builds layers. A frame node becomes a Frame; if it has `layout` it gets auto layout with the same direction, gap, padding and alignment. A text node becomes a Text layer after its font has been loaded. Fills, strokes, radii and effects are copied across; an image asset is decoded once and shared by every node that uses it. Custom properties become variables in a collection named after the source, and any node whose colour matches a variable is bound to it instead of getting a literal.

Every node draws even if the plugin does not understand one of its fields. An unknown field is ignored, never fatal. A font Figma lacks falls back to Inter and is named in the run's report.

## Why two halves

Figma's plugin sandbox cannot open a page. Its iframe can render HTML, but only what CORS lets it fetch, and never a page you are logged in to. A headless browser on your machine can open anything, but cannot talk to Figma.

So the two halves never meet. The extractor knows nothing about Figma; the plugin knows nothing about the DOM. The tree is the whole contract between them, and either side can be replaced or tested without the other: `packages/map` is tested on CSS strings, `plugin` on trees from `fixtures`.

## What determinism buys

The extractor gives each node an `id` derived from where the element is in the document, not from a counter. The same page captured twice gives the same ids, the same names and the same order.

That is what makes update in place possible. A second run with the same `source` finds the frames it drew before by `id` and changes them, rather than adding a second copy next to the first. Layers a designer renamed keep their names; layers the page no longer has are removed; new ones are added where the tree says. The run's report lists each.

It also makes trees diffable. Two captures of a page before and after a CSS change differ only where the CSS changed, which is how a page-comes-out-wrong report can be reduced to one node.
