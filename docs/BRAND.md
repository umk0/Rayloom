# Rayloom — Light Score

The user selected concept 2, **Light Score**, on 28 October 2026. The wordmark is
`public/brand/rayloom-lightscore-wordmark.png`; the approved board is
`artifacts/brand/rayloom-concepts-2026-10-28/02-light-score.png`.
The name appears once in the sidebar. Window controls remain in the titlebar.

## Application icon — 29 October 2026

A broad ivory **R** with one pale-lime ray crossing its upper bowl, on a charcoal
rounded tile. This continues the wordmark's horizontal slit and does not limit
the identity to RGB hardware. The generated source has transparent outer corners.
The symbol was generated with ImageGen using the approved board as the reference.
No third-party logo was imported. This is an original design direction, not a
claim of trademark clearance. The former three-stripe L icon is historical.

Assets in `public/brand/`:

- `rayloom-icon-source.png`: untouched generated master, 1254 × 1254.
- `rayloom-{16,20,24,32,40,48,64,128,256,512,1024}.png`: raster sizes.
- `rayloom.ico`: nine sizes from 16 to 256 px for Windows.
- `rayloom.icns`: seven PNG entries from 16 to 1024 px for macOS packaging.

The default/legacy favicon, Electron window and tray, macOS Dock configuration,
and Windows background launcher's embedded icon now reference Rayloom assets.
PNG/ICO/ICNS conversion uses Electron `nativeImage`; the packaging script opens no
windows and does not start the lighting agent or touch a user profile.

Regenerate formats with `npx electron scripts/package-brand.cjs`, then rebuild the
Windows launcher with `scripts/build-launcher.ps1 -SkipNodeCopy`.
Existing windows and pinned Windows shortcut caches do not update until their
normal restart/refresh. No running application was restarted for this change.
ICNS and Dock integration still require macOS acceptance; format validation on
Windows is not a macOS visual test. A vector master is still future work.

Final generation prompt (reference: approved Light Score board):

> Create one production desktop app icon for Rayloom derived faithfully from the approved Light Score identity in the reference image. The reference is a brand board; DO NOT output a board. Output only ONE centered square app icon. Preserve the distinctive custom capital R from the bottom-right approved icon: very broad futuristic ivory R, rounded squared upper bowl, strong straight upright stem, forceful diagonal lower leg. A single narrow horizontal slit runs from the left into the bowl and terminates in a rounded cap; insert one clean luminous pale-lime line into that slit. The R must clearly read as the same custom letter as the first letter of RAYLOOM on the reference, not a generic font or three independent stripes. It represents one precisely directed ray. Background is a smooth very dark charcoal rounded-square tile with restrained clean edge shaping, very subtle depth, nearly flat front-facing icon. Ivory main letter and pale lime single ray only; no rainbow, blue, purple, text, words, captions, border mockup, surrounding objects, drop shadow outside tile, or checkerboard drawn into image. Large bold silhouette for 16px and 32px legibility, substantial counters, optical spacing, generous 10% edge safety. Square 1024x1024 image; tile occupies 96% of canvas; transparent outside rounded tile corners. Crisp vector-like artwork, smooth untextured surfaces, no speckles, no grain. The supplied image is style/identity reference; generate a new clean final icon asset, not a screenshot crop.
