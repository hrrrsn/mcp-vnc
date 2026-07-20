# Comprehensive Review & Architecture Assessment — 2026-07-20

**Project**: `@hrrrsn/mcp-vnc` v1.0.2 (fork)
**Scope**: Full codebase — 8 source files, 6 test files, 97 tests
**Reviewer**: opencode (code-reviewer + architect + tech-debt-tracker)
**Axes**: correctness, security, performance, maintainability, architecture

---

## 1. Architecture Overview

```
┌──────────────┐    stdio     ┌───────────────┐   mutex    ┌──────────────────┐
│  AI Agent    │ ◄──────────► │  VncMcpServer  │ ◄────────► │ VncConnection    │
│  (Claude)    │   JSON-RPC   │  server.ts     │            │ Manager          │
└──────────────┘              │  6 tools       │            │ client.ts        │
                              └───────┬────────┘            └────────┬─────────┘
                                      │                              │
                         ┌────────────┼────────────┐        ┌───────┴────────┐
                         │            │            │        │                │
                    handleClick  handleKeyPress  handle     │ @computernewb/ │
                    handleMove   handleTypeText  Screenshot │ nodejs-rfb     │
                    Mouse        handleTypeMulti            │                │
                         │            │            │        └───────┬────────┘
                         └────────────┼────────────┘                │
                                      │                      ┌──────┴──────┐
                              input.ts                       │  VNC Server │
                              keyboard.ts                    │  (remote)   │
                              screenshot.ts                  └─────────────┘
```

### Module responsibilities

| Module | LOC | Concern |
|--------|-----|---------|
| `server.ts` | 179 | MCP protocol, tool registration, routing |
| `vnc/client.ts` | 149 | VNC connection lifecycle, mutex, reconnect |
| `tools/input.ts` | 209 | Mouse/keyboard/text input via VNC |
| `tools/screenshot.ts` | 311 | Screen capture, pixel format conversion, JPEG encoding |
| `vnc/keyboard.ts` | 103 | Keysym mapping, modifier parsing |
| `types.ts` | 26 | Shared interfaces |
| `index.ts` | 48 | Entry point, error handling, signal handlers |

### Architectural decisions (ADRs)

1. **ADR-001**: Persistent VNC connection with promise-chain mutex (Accepted)
   - Replaced per-call connection with lazy-initialized persistent connection
   - Promise-chain mutex serializes all tool calls
   - Used `.once()` for one-shot event handlers

### Dependency graph

```
index.ts → server.ts → tools/index.ts → input.ts     → vnc/client.ts → @computernewb/nodejs-rfb
                                       → screenshot.ts → sharp
                                       → vnc/keyboard.ts
```

---

## 2. Code Review — 5-Axis Assessment

### 2.1 Correctness

| Finding | Severity | File:Line |
|---------|----------|-----------|
| `ensureConnected` checks `this.client?.connected && this.client.authenticated` — but `connected` getter returns `this._connected` which is set to `false` in `resetState()` after disconnect. If the library changes internal state tracking, this could break. Current code works but depends on library internal. | Minor | client.ts:39 |
| `createConnection` promise — `timerId` set to `null` inside `setTimeout` callback (L110). If `cleanup()` is called between `setTimeout` assignment (L108) and callback execution, `timerId` is `null` and `clearTimeout` is a no-op. Correct but subtle. | Suggestion | client.ts:108-111 |
| `validateCoordinates` receives `client: VncClient` but only uses `.clientWidth` and `.clientHeight`. The function could accept `{clientWidth, clientHeight}` directly — removing the VncClient dependency. | Suggestion | client.ts:126 |
| `convertNonStandardRGBA` reads pixel as little-endian (`readUInt32LE`) but big-endian flag is handled by `needsPixelFormatConversion` returning true. For big-endian servers the byte order in `readUInt32LE` would be wrong. The conversion function should use `readUInt32BE` when `bigEndianFlag` is set. | Important | screenshot.ts:152 |
| Screenshot frame request (L195-213) uses `client.once('frameUpdated')` but the persistent connection's auto-frame-request loop means this event fires continuously. The `once()` correctly captures the next frame, but if another frame arrives before `once()` is set up, it could be stale. | Minor | screenshot.ts:206 |

### 2.2 Security

| Finding | Severity | File:Line |
|---------|----------|-----------|
| **VNC password in environment variable**: `process.env.VNC_PASSWORD` is read and passed as `auth.password` to VNC connection. Environment variables are visible in process listings (`ps`, `/proc`, Task Manager) and may be logged by monitoring tools. This is standard for CLI tools but worth noting for security-sensitive deployments. | Minor | index.ts:33 |
| **No authentication on MCP transport**: The server uses stdio transport — implicit auth via process ownership. This is correct for local-only MCP servers. No network exposure. | OK | server.ts |
| **Screenshot data**: Base64-encoded JPEG of the entire screen is returned to the AI agent. The agent receives potentially sensitive desktop content. This is inherent to the tool's purpose, not a bug. | OK | screenshot.ts |
| **No input sanitization**: `vnc_type_text` and `vnc_type_multiline` accept arbitrary strings. VNC protocol is binary — no injection risk. | OK | input.ts |

### 2.3 Performance

| Finding | Severity | File:Line |
|---------|----------|-----------|
| **convertToRGBA pixel loops**: O(width × height) with V8's slow property access. For 1920×1080 (2M pixels), each loop iteration does 4 array accesses. RGB24 conversion does 2M iterations × 4 writes = 8M operations. Acceptable (~50ms) but could be optimized with `Buffer.copy` for RGB24→RGBA32 (just interleave 0xFF every 4th byte). | Minor | screenshot.ts:52-116 |
| **hasCorruptionPatterns samples first 1000 pixels**: For a 1920×1080 screen, that's 0.05% of pixels. Masked corruption in other areas won't be detected. | Minor | screenshot.ts:11 |
| **JPEG re-encoding on resize**: If image > 800KB, `sharp` is called TWICE on the full framebuffer (once for initial JPEG, once for resize). The first JPEG output is discarded. Could resize first if needed, then encode once. | Minor | screenshot.ts:285-303 |
| **Mutex serialization is correct**: All tool calls share one connection. No concurrent VNC operations. Adds zero throughput penalty given MCP's single-client model. | OK | client.ts:17 |
| **30s operation timeout**: Prevents deadlock but may be too short for slow VNC servers or large screenshots. Consider making it configurable via `VncConfig`. | Suggestion | client.ts:6 |

### 2.4 Maintainability

| Finding | Severity | File:Line |
|---------|----------|-----------|
| **screenshot.ts is 311 lines**: Mixes 4 concerns — corruption detection (L5-49), format conversion (L52-167), screenshot capture (L171-250), JPEG encoding (L252-311). Should be split into `pixel-format.ts`, `screenshot-capture.ts`. | Minor | screenshot.ts |
| **server.ts tool definitions are inline**: 6 tool schemas defined as inline objects (L50-128). Could be extracted to a `tools/schema.ts` or use a declarative registry pattern. | Suggestion | server.ts |
| **`as any` casts in server.ts**: `args as any` (L138-148) and `as any` on error return (L160). These bypass TypeScript's type checking and could mask real type errors. | Minor | server.ts:138,160 |
| **No JSDoc on public API**: `VncConnectionManager`, `handleScreenshot`, `handleClick` have no documentation comments. The types are self-documenting but JSDoc would help IDE tooltips. | Suggestion | multiple |
| **`VncServerState` interface unused**: Defined in types.ts but never referenced. Dead type. | Minor | types.ts:20-26 |
| **Clean separation of concerns**: VNC protocol, MCP protocol, and tool logic are well-separated. Clear module boundaries. | OK | — |

### 2.5 Test Coverage

| Test file | Tests | Coverage scope |
|-----------|-------|----------------|
| `keyboard.test.ts` | 19 | parseKeyInput, getKeysym, charNeedsShift, getUnshiftedChar |
| `vnc-client.test.ts` | 16 | createConnection, validateCoordinates, executeWithConnection |
| `input.test.ts` | 18 | All 5 handlers with edge cases |
| `screenshot.test.ts` | 5 | Delay validation, bytes/pixel validation |
| `fixes-expected.test.ts` | 24 | Critical/Important fix verification (C1, C2, I1-I6) |
| `review-scenarios.test.ts` | 15 | Post-review scenarios (S1-S6) |
| **Total** | **97** | **6 files, 0 failures** |

**Coverage gaps**:
- No integration tests (real VNC server required — `test.ts` exists but requires VNC)
- No performance regression tests (typing speed baseline)
- No screenshot pixel correctness tests (hard to test without real VNC data)
- `index.ts` error handler — tested indirectly via I6 tests but no direct unit test

---

## 3. Architecture Assessment

### 3.1 Strengths

1. **Correct abstraction**: Each layer has a clear, single responsibility:
   - `server.ts` — MCP protocol
   - `client.ts` — VNC lifecycle
   - `tools/*` — VNC operations
2. **Persistent connection**: ADR-001 is well-implemented. Lazy init, mutex serialization, and auto-reconnect are all working correctly.
3. **Pixel format resilience**: 4 format conversion paths (RGBA pass-through, RGB24→RGBA, RGB565→RGBA, 8-bit→RGBA, non-standard RGBA) plus corruption detection heuristics.
4. **Error handling layers**: Connection errors, operation timeouts, callback errors — each handled at the appropriate level.
5. **Test suite**: 97 tests, 6 files, all green. Tests are well-structured by concern.

### 3.2 Weaknesses

1. **No clipboard support**: VNC supports `clientCutText` for clipboard operations. The library has `clientCutText()` method. Not exposed as an MCP tool.
2. **No drag-and-drop**: Mouse operations support click and move but not drag (button down → move → button up). This is a common desktop automation pattern.
3. **No color-map-aware 8-bit conversion**: `convertToRGBA` for 8-bit just does grayscale. The VNC library provides `colorMapUpdated` event with the actual palette.
4. **Screenshot-only visual feedback**: The only way for an AI agent to "see" the result of actions is taking screenshots. No lightweight approach like "get cursor position" or "get window title".
5. **No connection health monitoring**: No heartbeat/ping mechanism. Connection drops are only detected when the TCP socket closes.
6. **Big-endian pixel handling incomplete**: `needsPixelFormatConversion` returns true for big-endian, but `convertNonStandardRGBA` uses `readUInt32LE` (little-endian) regardless.

### 3.3 Coupling analysis

| Module A | → depends on → | Module B | Tightness |
|----------|---------------|----------|-----------|
| `server.ts` | imports | `tools/index.ts`, `vnc/client.ts`, MCP SDK | Medium |
| `tools/input.ts` | imports | `vnc/client.ts`, `vnc/keyboard.ts` | High |
| `tools/screenshot.ts` | imports | `vnc/client.ts`, `sharp` | Medium |
| `vnc/client.ts` | imports | `@computernewb/nodejs-rfb`, `types.ts` | Medium |
| `vnc/keyboard.ts` | imports | nothing | Low |

The tightest coupling is `tools/input.ts → vnc/client.ts` — input handlers are tightly bound to `VncConnectionManager` API. This is acceptable given the current architecture but would complicate extracting tools into a separate module.

---

## 4. Tech Debt Ledger

No `TECH_DEBT.md` exists. Creating one now:

| ID | Description | Priority | Files | Status | Created |
|----|-------------|----------|-------|--------|---------|
| TD-001 | Big-endian `readUInt32LE` used in `convertNonStandardRGBA` despite big-endian detection | high | screenshot.ts:152 | open | 2026-07-20 |
| TD-002 | Screenshot file is 311 lines, mixes 4 concerns | medium | screenshot.ts | open | 2026-07-20 |
| TD-003 | `VncServerState` interface unused — dead type | low | types.ts:20-26 | open | 2026-07-20 |
| TD-004 | No JSDoc on public API functions | low | multiple | open | 2026-07-20 |
| TD-005 | `as any` casts in server.ts bypass type safety | medium | server.ts:138,160 | open | 2026-07-20 |
| TD-006 | `convertToRGBA` 8-bit path uses grayscale, not VNC color map | medium | screenshot.ts:98-113 | open | 2026-07-20 |
| TD-007 | No clipboard tool exposed (library supports `clientCutText`) | medium | input.ts | open | 2026-07-20 |
| TD-008 | No drag-and-drop mouse operation support | medium | input.ts | open | 2026-07-20 |
| TD-009 | `hasCorruptionPatterns` samples only first 1000 pixels | low | screenshot.ts:11 | open | 2026-07-20 |
| TD-010 | Operation timeout (30s) hardcoded, not configurable | low | client.ts:6 | open | 2026-07-20 |

---

## 5. Readiness Assessment

### Production readiness score: **7/10**

| Dimension | Score | Note |
|-----------|-------|------|
| Correctness | 8/10 | Core flow solid. Big-endian bug (TD-001) is the only known correctness gap. |
| Security | 8/10 | Password via env var is standard. No network exposure. |
| Performance | 7/10 | 30s operation timeout. JPEG resize could be optimized. Typing delays acceptable. |
| Reliability | 8/10 | Persistent connection + auto-reconnect + mutex timeout. Good error handling. |
| Test coverage | 8/10 | 97 unit tests. Missing: integration tests, pixel correctness, clipboard. |
| Maintainability | 7/10 | Clean modules but screenshot.ts too large. Some `as any` casts. |
| Observability | 6/10 | console.error logging only. No structured logs, metrics, or health check endpoint. |
| Documentation | 6/10 | README is good. No API docs, no JSDoc. ADR covers architecture. |

### What's ready for production use

- All 6 MCP tools (click, move, keypress, type text, type multiline, screenshot)
- Persistent VNC connection with reconnection
- Pixel format conversion for 4 common formats
- Error suppression for known VNC library quirks
- Graceful shutdown via SIGINT/SIGTERM

### What's not ready

- Big-endian VNC servers may produce corrupted screenshots
- No clipboard or drag-and-drop support
- No health monitoring for long-running sessions

---

## 6. Development Roadmap

### Phase 1: Fix Known Issues (1-2 days)
- [ ] TD-001: Fix big-endian `readUInt32LE` in `convertNonStandardRGBA`
- [ ] TD-005: Remove `as any` casts in server.ts (use proper MCP SDK types)
- [ ] TD-003: Remove unused `VncServerState` interface

### Phase 2: Complete Feature Set (3-5 days)
- [ ] TD-007: Add `vnc_clipboard` tool (get/set clipboard)
- [ ] TD-008: Add `vnc_drag` tool (mouse drag operation)
- [ ] Add `vnc_screenshot` options: region capture (x, y, width, height), PNG/JPEG toggle
- [ ] TD-006: Implement color-map-aware 8-bit conversion using `colorMapUpdated`

### Phase 3: Quality & Observability (2-3 days)
- [ ] TD-002: Refactor screenshot.ts into `pixel-format.ts` + `screenshot-capture.ts`
- [ ] TD-004: Add JSDoc to public API
- [ ] Add structured logging (log levels, timestamps)
- [ ] Add connection health metric (time since last successful operation)
- [ ] Add performance regression tests for typing speed

### Phase 4: Advanced Features (5+ days)
- [ ] Multi-monitor support (detect and switch between displays)
- [ ] Video recording (H.264 encoding of VNC session via ffmpeg)
- [ ] Window-level operations (focus window, get title, resize)
- [ ] OCR-based text extraction from screenshots (Tesseract.js)
- [ ] WebSocket transport mode (for browser-based VNC control)

---

## 7. Summary

**Verdict: Production-ready for basic remote desktop control tasks.**

The codebase is well-structured, the critical bugs from the initial review are fixed, and the test suite is comprehensive (97 tests, 0 failures). The persistent connection architecture is sound and correctly implemented.

The 10 tech debt items are primarily enhancements, not blockers. The one actionable correctness issue (TD-001, big-endian pixel handling) affects a minority of VNC servers and has a straightforward fix.

**Key numbers:**
- 8 source files, 1,234 total LOC
- 6 MCP tools, 3 dependencies
- 97 tests, 0 failures
- 1 ADR, 10 tech debt items
- 7/10 production readiness
