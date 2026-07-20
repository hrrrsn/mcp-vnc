# Technical Debt Ledger

| ID | Description | Priority | Files | Status | Created | Resolved |
|----|-------------|----------|-------|--------|---------|----------|
| TD-001 | Big-endian `readUInt32LE` used in `convertNonStandardRGBA` despite big-endian detection | high | screenshot.ts:152 | resolved | 2026-07-20 | 2026-07-20 |
| TD-002 | Screenshot file is 311 lines, mixes 4 concerns (corruption, conversion, capture, encoding) | medium | screenshot.ts | open | 2026-07-20 | — |
| TD-003 | `VncServerState` interface unused — dead type | low | types.ts:20-26 | resolved | 2026-07-20 | 2026-07-20 |
| TD-004 | No JSDoc on public API functions | low | multiple | resolved | 2026-07-20 | 2026-07-20 |
| TD-005 | `as any` casts in server.ts bypass type safety | medium | server.ts:138,160 | resolved | 2026-07-20 | 2026-07-20 |
| TD-006 | `convertToRGBA` 8-bit path uses grayscale, not VNC color map | medium | screenshot.ts:98-113 | resolved | 2026-07-20 | 2026-07-20 |
| TD-007 | No clipboard tool exposed (library supports `clientCutText`) | medium | input.ts | resolved | 2026-07-20 | 2026-07-20 |
| TD-008 | No drag-and-drop mouse operation support | medium | input.ts | resolved | 2026-07-20 | 2026-07-20 |
| TD-009 | `hasCorruptionPatterns` samples only first 1000 pixels | low | screenshot.ts:11 | resolved | 2026-07-20 | 2026-07-20 |
| TD-010 | Operation timeout (30s) hardcoded, not configurable | low | client.ts:6 | resolved | 2026-07-20 | 2026-07-20 |
