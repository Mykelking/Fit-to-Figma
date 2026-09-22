# Publishing to the Figma Community

These steps happen on figma.com and in the Figma desktop app, under the owner's account. The repo builds the plugin; publishing is the owner's step, not the repo's.

## Have ready

- A Figma account. Publishing needs a verified email and an accepted Community agreement, both done once in Figma's own settings.
- The built plugin: `npm run build -w plugin`, giving `plugin/manifest.json` and `plugin/dist/`. Use the zip from the latest GitHub release if you want the exact tagged build.
- A cover image, 1920 x 960 PNG or JPG.
- An icon, 128 x 128 PNG.
- Three screenshots, 1920 x 960 or larger at 2:1. What each shows is in [listing.md](listing.md).
- The name, tagline, description, tags and network access statement from [listing.md](listing.md).
- A support contact: the repository's Issues URL.

## Steps

1. Open Figma desktop. Open any design file.
2. Plugins · Development · Import plugin from manifest. Pick `plugin/manifest.json`. Run it once on a page to confirm the build works.
3. Plugins · Development · Manage plugins in development. Pick Fit to Figma. Press Publish.
4. Fill the form:
   - Name and tagline from listing.md.
   - Icon, cover and the three screenshots.
   - Description from listing.md.
   - Tags and category.
   - Support contact: the Issues URL.
   - Network access: paste the statement from listing.md. The form shows this only when the manifest's `networkAccess` is not `none`; what you paste must describe what the manifest allows.
   - Publisher: your own profile, not a team, unless you want the team's name on it.
   - Price: free.
5. Press Submit for review.
6. Wait. Figma reviews plugins by hand; it takes days, sometimes more than a week. You get an email either way. If it is rejected, the email says why; fix that one thing and submit again.
7. When it is approved, the Community page is live at `figma.com/community/plugin/<id>`. Put that URL in README.md under Install.

## Updating

Later versions go through the same form: Manage plugins in development · Fit to Figma · Publish new version. The plugin id in `manifest.json` must not change between versions, or Figma treats it as a new plugin. Each new version is reviewed again, more quickly than the first.

## Do not

- Do not commit the cover, icon or screenshots to the repo unless they are small. They are the listing's, not the code's.
- Do not change the plugin id in `manifest.json` after the first publish.
- Do not publish from a build that is not tagged; the release zip is what users will match against.
