# Fit to Figma

A Figma plugin that turns a web page or an HTML file into native Figma layers: frames with auto layout, text in the real fonts, fills, strokes, radii, shadows, vectors and variables. Not a screenshot - layers you can edit.

![Fit to Figma turning a page into layers](docs/assets/readme-hero.png)

## Three ways in

**Drop a tree from the CLI.** Run the CLI against a URL or a file; it opens the page in a headless browser and writes a `.tree.json`. Drop that file on the plugin. Works for anything the browser can open, including pages you are logged in to, and is not limited by CORS.

**Drop or paste HTML.** Drop an `.html` file on the plugin, or paste markup into it. The plugin renders it in its own window and reads the layout from there. Linked stylesheets and images must be reachable from that window.

**From a URL.** Paste a URL. The plugin fetches and renders it, so it only works where the server allows cross-origin reads and the plugin's manifest lists the domain. The shipped manifest lists none; a development install can add domains to `plugin/manifest.json`. Anything else, use the CLI.

## Install

**Users:** open Fit to Figma on the Figma Community and press Run or Save. Nothing else to install.

**Development:** clone the repo, `npm install`, `npm run build -w plugin`, then in Figma desktop: Plugins · Development · Import plugin from manifest, and pick `plugin/manifest.json`.

## The CLI

```
npm install -g fit-to-figma
fit-to-figma https://example.com -o example.tree.json
fit-to-figma ./page.html --viewport 390x844 -o page.tree.json
```

It writes one JSON file, the design tree, described in [docs/DESIGN-TREE.md](docs/DESIGN-TREE.md). Drop it on the plugin. The same page gives the same tree, so a second drop updates the frames already on the canvas instead of adding new ones.

## What maps to what

| On the page | In Figma |
| --- | --- |
| element box | Frame, named `tag.class.class` |
| `display: flex` or `grid` | Frame with auto layout: direction, gap, padding, align, justify, wrap |
| any other container | Frame with absolutely placed children |
| width, height, `flex-grow`, fit-content | fixed, fill, hug |
| `background-color` | solid fill |
| `linear-gradient` | linear gradient fill |
| `background-image`, `<img>` | image fill or image layer |
| inline `<svg>` | vector |
| `border` | stroke: weight, colour, alignment |
| `border-radius` | corner radius, per corner |
| `box-shadow` | drop shadow |
| `filter: blur` | layer blur |
| `backdrop-filter: blur` | background blur |
| `opacity` | layer opacity |
| `overflow: hidden` | clip content |
| text | Text layer: family, weight, style, size, line height, letter spacing, colour, align, decoration, case |
| icon font glyph | Text layer |
| CSS custom properties | Figma variables, in a collection named after the source; matching colours are bound to them |
| hidden, zero-size or off-canvas elements | dropped |

Boxes come from the browser's layout, not from the stylesheet: what Figma gets is what the page drew. A font Figma does not have falls back to Inter and is listed in the run's report.

## What it cannot do yet

- Components. Repeated classes come out as repeated frames, not instances.
- Radial and conic gradients. They come out as a solid of the first stop.
- `<canvas>` and `<video>`. Each becomes one image of its current frame.
- Pages behind CORS, from inside the plugin, and any URL at all from the Community build, which allows no domains. Use the CLI.
- Hover, focus and animation states. Only what is on screen at capture.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most useful thing: a page that comes out wrong, filed with its tree attached.

## Licence

MIT. See [LICENSE](LICENSE).
