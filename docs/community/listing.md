# Figma Community listing

Everything the publish form asks for, ready to paste.

## Name

Fit to Figma

## Tagline

Any web page or HTML file, as native Figma layers.

(49 characters. Limit is 60.)

## Description

Turns a web page or an HTML file into Figma layers you can edit: frames with auto layout, text in the page's fonts, fills, strokes, radii, shadows, vectors and variables. Not a screenshot.

Two ways in: drop an .html file or paste markup, or drop a tree from the free CLI, which opens any URL in a headless browser on your machine, including pages you are logged in to.

Flex and grid become auto layout. Borders, radii, shadows and blurs become their Figma equivalents. Inline SVG becomes vectors. CSS custom properties become variables. A second run on the same page updates the frames in place.

Not yet: components from repeated classes, radial gradients, live canvas or video.

Open source, MIT. Report a wrong page on GitHub, tree attached.

(Under 800 characters.)

## Tags

html, css, import, web, code to design, auto layout, variables, developer, handoff

## Category

Developer tools

## Screenshots

Three, each 1920 x 960 or larger at 2:1. Take them on a real page, not a demo. Same page across all three so a viewer can follow it.

1. **Before and after.** Left half: the page in a browser. Right half: the same page on the Figma canvas, layers panel open, showing the named frames (`header.site-header`, `button.btn.btn--primary`). The point: it is layers, not a picture.
2. **Auto layout.** One card or nav bar selected in Figma, the Design panel open on the right showing auto layout direction, gap and padding filled in. Crop tight enough to read the numbers.
3. **Variables.** The Variables panel open with the collection named after the source page, and a selected layer's fill showing the bound token, e.g. `--color-primary`. Optionally the plugin window in a corner with the run's report visible.

Cover, 1920 x 960: the plugin name, one line of the tagline, and the before-and-after from screenshot 1 behind it. No other text.

Icon, 128 x 128: the wordmark or a glyph, on a solid background.

## Network access statement

The shipped `plugin/manifest.json` sets `networkAccess.allowedDomains` to `["none"]`, so the form does not ask for a reasoning and the listing can say:

> Fit to Figma makes no network requests. It reads a tree file or HTML you hand it and draws it. To capture a page by URL, use the free CLI on your own machine.

If a later version lists domains in the manifest, Figma asks for a reasoning. Paste this and keep the manifest's `reasoning` field the same:

> When the user pastes a URL, the plugin fetches that URL and the stylesheets, images and fonts it links, to render the page in the plugin window and read its layout. It fetches only what the user asked for, sends nothing to any other host, and stores nothing outside the Figma file.

## Support

GitHub Issues on the repository. The issue templates ask for the tree.
