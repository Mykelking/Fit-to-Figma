# Security

## What reaches the network

By default, nothing. The shipped `plugin/manifest.json` sets `networkAccess.allowedDomains` to `none`, so Figma blocks every request from the plugin. Dropping a tree or an HTML file is handled inside the plugin window. No page content, tree or usage data leaves Figma.

If a development install adds domains to the manifest and a URL is pasted, the plugin fetches that URL and what it links (stylesheets, images, fonts) from the plugin window, subject to the browser's cross-origin rules. It sends nothing to any other host.

The CLI runs on your machine, opens the page you name in a headless browser, and writes one file to the path you give. It reaches no other host.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private report on this repository: Security tab · Report a vulnerability. You will get a reply within seven days, and a fix or a reason before anything is made public.

In scope: anything that makes the plugin or CLI send data where it should not, run code from a page, or write outside the path it was given.
