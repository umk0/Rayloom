# Native effect previews

The editor requests `NativeEffectPreviews.frame({effectId, color, speed, animate})`.
This service is editor-owned; the background lighting agent never receives a
preview request. On first use it starts a separate native process with a fresh
temporary profile, `--nodetect`, `--noautoconnect`, virtual-device mode and only
the bundled Effects Plugin. The plugin additionally rejects preview RPC unless
both dedicated-preview and virtual-mode environment flags are present.

`LumenEffectPreview` creates an unregistered 32×16 virtual matrix with no device
callbacks. It constructs the requested upstream `RGBEffect` class and calls its
actual `StepEffect`, without EffectManager assignments, profile loading or
`UpdateLEDs`. This also isolates effects' shared random-number state from real
lighting. Preview settings and actual scene settings share
`shared/native-effect-config.mjs`; the first generic or custom palette color
tracks the selected color, and speed uses the same native range mapping.

Only one native effect is active. The initial sample uses 60 bounded algorithm
steps at 30 FPS (two seconds of simulation for iterative algorithms). Algorithms
using wall-clock time retain their own clock, so a first frame may be dark during
their natural delay. A hovered preview subsequently runs a 30 FPS native timer;
the UI may read frames less frequently. Native rendering pauses after 800 ms
without requests, and the service normally releases the process after 5 seconds.
The plugin has a 15-second orphan watchdog. Closing the editor disposes the
service. An LRU cache holds at most 192 real sampled frames, keyed by DLL SHA256,
effect, color, speed and fixture. There are no name-based substitute animations.

## Current coverage

- 45 effects return actual RGB frames.
- 8 audio effects capture the actual Windows system output while hovered or
  keyboard-focused. Without animation they return `needs-input: audio-hover`
  or their last real cached frame; they do not start background capture.
- Ambient requires `screen`, GIFPlayer `image`, Shaders `shader`, Layers `layers`,
  and CustomBlink `sequence`.

The five file/composition/screen effects still require their own input. Providing
editable input fixtures for those types is a further capability; their full
native configuration remains available in the advanced effects panel.
Audio cards report listening, silence, or an unavailable output. Source and gain
are real effect settings shared with playback. Quiet audio may remain below the
algorithm's threshold at its default gain; the sensitivity control explains this.
No microphone capture or audio file recording is added by the preview.
Black or uniform output can be a valid result for a selected native palette or
the initial delay of an effect. The preview does not invent extra colors.

## Verification

`node scripts/test-effect-previews.mjs` uses only isolated virtual processes.
It checks all 58 entries, packed RGB bounds, settings equality with actual scene
configuration, exact color changes, speed-dependent phase, real timer animation,
cache behavior, process disposal, and RPC rejection outside preview mode. It also
compares the worker's scene and registered device data before/after all previews:
both remain unchanged, and the private matrix never enters the device inventory.
The report is `artifacts/effect-previews-smoke.json`.

`artifacts/audio-previews-smoke.json` verifies all eight audio effects, stop and
extreme low-pass values. `artifacts/audio-loopback-smoke.json` records a quiet
1.5-second, -26 dB tone: real loopback peak 0.05001068 and 32 changed AudioSync
frames at effect sensitivity 1000. System volume and physical LEDs were not
changed. PCM frame decoding and FFT boundary handling have targeted tests.

These checks verify execution and isolation, not an optical comparison with
physical LEDs. Matrix dimensions and selected device topology can change an
effect's appearance; the card represents the documented 32×16 fixture.
