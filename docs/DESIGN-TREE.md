# The design tree

Fit to Figma has two halves that never meet except through one file: the
extractor reads a page and writes a design tree; the plugin reads a design
tree and builds Figma layers. This is the tree. Both halves are written
against it, and a change to it is a change to both.

Version 1. JSON. Positions in CSS pixels, relative to the root frame.

```jsonc
{
  "version": 1,
  "source": { "kind": "url" | "file", "ref": "https://…", "title": "…", "capturedAt": "RFC 3339", "viewport": { "w": 390, "h": 844 } },
  "page": "Screens",                         // optional: the Figma page the root frame goes on
  "section": "Onboarding",                   // optional: the section on that page it goes in
  "place": { "x": 0, "y": 0 },               // optional: where the root frame goes on the page
  "fonts": [ { "family": "Plus Jakarta Sans", "weights": [400, 600, 700] } ],
  "assets": { "<id>": { "type": "image" | "svg", "mime": "image/png", "data": "<base64 or svg markup>", "w": 0, "h": 0 } },
  "tokens": [ { "name": "--color-primary", "value": "#9c4679", "kind": "color" | "number" | "string" } ],
  "root": { /* Node */ }
}
```

A Node:

```jsonc
{
  "id": "n12",
  "name": "button.btn.btn--primary",        // what the layer is called in Figma
  "type": "frame" | "text" | "image" | "vector",
  "x": 0, "y": 0, "w": 0, "h": 0,            // absolute, relative to root
  "layout": {                                // frames only; absent = no auto layout
    "mode": "row" | "column",
    "gap": 8,
    "padding": [12, 16, 12, 16],             // top, right, bottom, left
    "align": "start" | "center" | "end" | "stretch",     // cross axis
    "justify": "start" | "center" | "end" | "space-between",
    "wrap": false
  },
  "sizing": { "w": "fixed" | "fill" | "hug", "h": "fixed" | "fill" | "hug" },
  "fills": [ { "type": "solid", "color": "#rrggbb", "opacity": 1 } | { "type": "linear", "angle": 90, "stops": [ { "at": 0, "color": "#…", "opacity": 1 } ] } | { "type": "image", "asset": "<id>", "scale": "fill" | "fit" } ],
  "strokes": { "color": "#…", "opacity": 1, "weight": 1, "align": "inside" | "center" | "outside" },
  "radius": [8, 8, 8, 8],                    // tl, tr, br, bl
  "effects": [ { "type": "shadow" | "inner-shadow", "x": 0, "y": 2, "blur": 8, "spread": 0, "color": "#…", "opacity": 0.2 } | { "type": "blur", "radius": 12 } | { "type": "backdrop-blur", "radius": 12 } ],
  "opacity": 1,
  "clip": true,
  "flow": "absolute",                        // optional: the browser took this box out of the flow
  "text": {                                  // text only
    "content": "Join",
    "font": { "family": "…", "weight": 700, "style": "normal" | "italic", "size": 16, "lineHeight": 24, "letterSpacing": 0 },
    "lines": 1,                              // optional: line boxes the browser drew this run on
    "lineBoxes": [ { "text": "…", "x": 0, "y": 0, "w": 0, "h": 0 } ],   // optional: one entry per line, when the run wrapped
    "color": "#…", "opacity": 1,
    "align": "left" | "center" | "right",
    "decoration": "none" | "underline" | "strike",
    "transform": "none" | "upper" | "lower"
  },
  "asset": "<id>",                           // image and vector only
  "semantic": { "tag": "button", "classes": ["btn", "btn--primary"], "role": "button" },
  "children": []                             // frames only, in paint order
}
```

What the shapes above leave unsaid:

- A `shadow` is a drop shadow; an `inner-shadow` is the same thing drawn inside the box, which is CSS `inset` and what Figma calls an inner shadow.
- A gradient `stop`'s `at` runs 0 to 1 along the gradient line, not 0 to 100.
- A linear paint's `angle` is degrees clockwise from "to top", the same reading CSS uses: 0 points up, 90 points right, 180 points down. A CSS corner keyword becomes the 45 degree diagonal, because a corner in CSS follows the box's shape and Figma's angle does not.
- `page` is the name of the Figma page the root frame goes on, and it is optional. The plugin takes the first page with that name, or makes one; a tree without it builds on the page you are looking at. When a run names pages it leaves you on the first one named.
- `section` is the name of a Figma section on that page, and it is optional. The plugin takes the first section of that name or makes one under everything already on the page, and `place` is then read inside the section. At the end of a run each section it touched is drawn round its frames with 80 px of air on every side.
- `place` is where the root frame goes on the Figma page, in Figma canvas units, absolute, and it is optional. A tree without it is laid out beside the last one, from the centre of the view. The plugin rounds both numbers, and it ignores `place` when it is updating an existing frame in place: the frame already on the page keeps its position.
- `lines` is how many line boxes the browser drew a run on, and it is optional. Figma's metrics are not the browser's, so a run drawn on one line is told to size itself rather than wrap; a run that wrapped keeps its width and grows downwards. Without it the plugin reads the run's height against its line height.
- `lineBoxes` is every line of a run that wrapped, in order, each with the words on it and the box the browser drew them in, positioned like any other node. It is there whenever `lines` is more than one. The plugin draws one text layer per line so nothing can break at a different word than the page did.
- `flow` says the browser took the box out of the flow: `position` was absolute, fixed or sticky. It changes nothing about the box, which is where the element ended up; it tells the plugin that a child of an auto layout frame is not one of the laid out ones.
- A token's `value` is always the string the page held; `kind` says how to read it.
- `layout`, `sizing`, `strokes`, `text` and `semantic` are each optional, but when one is present every field in it is there.
- An `image` or a `vector` node always has an `asset`, and a `text` node always has `text`. Nothing else is made compulsory by a node's `type`.
- Lengths are numbers of CSS pixels, never strings with units. `lineHeight` and `letterSpacing` are already resolved to pixels.

Rules the extractor keeps:

- Boxes come from the browser's layout, not from the stylesheet: what Figma gets is what the page drew.
- A flex or grid container becomes `layout`; anything else is a frame with absolutely placed children.
- Text is one node per element that holds text, with the run's computed font. A text node with mixed runs is split into siblings.
- Inline SVG becomes a vector asset; `<img>` and CSS background images become image assets; an icon drawn by a font stays text.
- Hidden, zero-sized and off-canvas elements are dropped. Scroll containers keep the visible part.
- `semantic` is carried for the plugin's component matching and is never needed to draw.

One file can hold many trees: a JSON array of whole trees, by convention named
`.trees.json`. The plugin builds them in order and does not read the extension.
The Tree tab takes many such files in one drop and builds them one file at a
time, so a whole design arrives in a single go.

Rules the plugin keeps:

- Every node draws even when it does not understand a field; an unknown field is ignored, never fatal.
- Fonts are loaded before text is set; a font Figma does not have falls back to Inter and is listed once in the run's report.
- `tokens` become Figma variables in a collection named after the source; a node's colour that matches a token is bound to it.
- A second run with the same source updates frames by `id` in place.

## Decisions the first fixtures forced

- **An element that both paints and holds text is a frame with one text child.** Figma text cannot carry a background, a border, a shadow or padding, so a badge or a button label becomes a frame (its box, fills, strokes, radius, effects, padding) holding a text node (the run). An element that paints nothing and has no padding is a text node on its own.
- **A mixed-run element keeps its wrapper.** A paragraph with a bold run becomes a frame in row layout that wraps, holding one text node per run, so the runs reflow together in Figma.
- **Wrapper chains are never collapsed.** A `div` holding one `div` holding one `span` is three nodes. Fidelity to the page wins over a tidier layer list; a later option may flatten, and it is off by default.
- **Elliptical radius takes the horizontal value, then clamps to half the shorter side.** `60px / 24px` on a 220x80 box is 40.
- **Hidden means any of:** `display: none`, `visibility: hidden`, `opacity: 0`, zero width or height after layout, or a box entirely outside the root's box. Off-canvas is hidden. Inside a scroll container, a child entirely outside the container's visible box is dropped; one partly inside is kept whole and the container clips.
