# Device and geometry catalog

`data/device-catalog.json` schema 2 combines the original OpenRGB 1.1 support
table with an index generated from our actual vendored native detectors and
literal LED matrices. The old `devices[]` interface remains compatible.

Generate with `npm run catalog:update`; `node scripts/update-device-catalog.mjs
--offline` reuses the cached upstream table and refreshes the native index.
The generator saves exact source paths, line numbers, SHA-256 values, native
Git revision and aggregate source digest. Local uncommitted changes are covered
by those hashes; the Git revision alone is not the complete source identity.

The initial snapshot contains 312 support-table rows, 1,945 named detector
records (1,932 unique names, 2,140 registration declarations), and 63 literal
matrix templates. These are **catalog records**, not 2,257 devices tested by
Lumen. Conditional builds, disabled detectors, firmware, transport interfaces
and OS permissions still determine what can actually be controlled.

Each `layouts[]` entry has a stable ID, controller family, source variable name,
rows, columns, a matrix of LED indices with `null` holes, unique `ledCount`, and
`requiredLedCount` (maximum index + 1). Templates preserve native LED order.
They are not applied automatically. Confirm the exact model/variant and live
controller LED count before using one. For example, VK99 has 102 LEDs while the
VK99 Pro template has 98; matching the manufacturer alone would be incorrect.
Runtime-provided zone matrices remain authoritative for connected devices.

The parser intentionally skips expressions, unknown constants and incomplete
arrays. It does not fabricate a rectangular layout from an LED count and never
uses catalog matches as permission to issue a device protocol.

## Additional sources reviewed

The machine-readable inventory with license links is
[`catalog-sources.json`](../data/catalog-sources.json). External projects are
references in this snapshot; their drivers and assets are not bundled.

| Source | Useful material | Current handling |
| --- | --- | --- |
| [QMK](https://github.com/qmk/qmk_firmware) | Keyboard identity and actual RGB matrix coordinates | Check each file's license, hardware revision and LED order before import. A switch matrix is different from an RGB LED matrix. |
| [VIA](https://github.com/the-via/keyboards) | VID/PID and key positions | GPL-3.0 definitions; a key layout does not establish host-controllable RGB. |
| [RGB.NET](https://github.com/DarthAffe/RGB.NET) | Providers, layout format, LED naming | LGPL-2.1 library; some providers depend on vendor SDKs. |
| [Aurora](https://github.com/Aurora-RGB/Aurora) | Layouts and game integration adapters | MIT candidate for individually attributed future adapters. |
| [Artemis plugins](https://github.com/Artemis-RGB/Artemis.Plugins) | 165 layout XML files at the reviewed revision | Current PolyForm Noncommercial license; no layouts or images copied into this unrestricted fork. |
| [SignalRGB](https://signalrgb.com/devices/) | Support cross-check and [plugin concepts](https://docs.signalrgb.com/developer/plugins/) | No blanket code/asset reuse license established. Community repositories need separate review. |

Adding a support record, adding a geometry template and implementing a hardware
driver are separate contributions. A future importer should keep source URL,
revision, author/license, VID/PID/interface constraints, layout variant, LED
count/order and verification status together, and never claim device support
solely because a third-party catalog mentions that model.
