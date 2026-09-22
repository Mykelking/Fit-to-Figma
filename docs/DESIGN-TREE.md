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
  "effects": [ { "type": "shadow", "x": 0, "y": 2, "blur": 8, "spread": 0, "color": "#…", "opacity": 0.2 } | { "type": "blur", "radius": 12 } | { "type": "backdrop-blur", "radius": 12 } ],
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
