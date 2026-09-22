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
  "text": {                                  // text only
    "content": "Join",
    "font": { "family": "…", "weight": 700, "style": "normal" | "italic", "size": 16, "lineHeight": 24, "letterSpacing": 0 },
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
