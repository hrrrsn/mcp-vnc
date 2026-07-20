# Research: Fix Critical & Important Review Findings

**Date**: 2026-07-20
**Goal**: Determine the optimal approach to fix 2 Critical + 5 Important issues from code review
**Time box**: 30 min (Large)

---

## Codebase Findings

### Affected files (by severity)

| File | Issues | LOC impact |
|------|--------|-----------|
| `src/vnc/client.ts` | C1: timer leak, C2: race condition, I1: per-call connection, I5: validateCoordinates | ~100 LOC |
| `src/tools/screenshot.ts` | I2: dead code (convertBGRXToRGBA), I3: dead code (needsPixelFormatConversion) | -40 LOC |
| `src/tools/input.ts` | I4: slow char-by-char typing | ~20 LOC |
| `src/index.ts` | I6: silent error swallowing | ~10 LOC |

### Call chain

```
server.ts::CallToolRequestSchema → handleClick/handleMoveMouse/... → vncManager.executeWithConnection()
  → createConnection() [NEW CONNECTION PER CALL] → setTimeout leak → callback(client) → disconnect()
```

### VNC Library API (@computernewb/nodejs-rfb)

Events: `connected`, `connectTimeout`, `authenticated`, `authError`, `disconnect`, `connectError`, `firstFrameUpdate`, `frameUpdated`, `bell`, `cutText`, `colorMapUpdated`, `rectProcessed`

Key methods: `connect(opts)`, `disconnect()`, `requestFrameUpdate(full, inc, x, y, w, h)`, `sendKeyEvent(keysym, down)`, `sendPointerEvent(x, y, b1..b8)`, `resetState()`, `changeFps(n)`

Properties: `clientWidth`, `clientHeight`, `fb` (framebuffer), `pixelFormat`

Notable: `firstFrameUpdate` event exists — fires once on initial frame, ideal for connection readiness signal.

### Key constraint

VNC protocol is **sequential** (one frame request → one frame response). Concurrent operations (key press + screenshot at same time) would corrupt `client.fb` and `client.pixelFormat`. We need **mutual exclusion** for all tool calls sharing one connection.

---

## Sources

1. Library README (extracted via Tavily): `github.com/computernewb/nodejs-rfb`
2. MCP Specification (2025-03-26): `modelcontextprotocol.io/specification/basic/lifecycle`
3. Codebase: 9 TS files, ~1300 LOC (read in full)

---

## Findings

### C1: Timer Leak (client.ts:77-79)

**Root cause**: `setTimeout(() => reject(...), 15000)` is never cleared. Timer reference not stored.
**Risk**: Memory leak (15000ms timer per connection), stale rejection after `resolve()`.
**Fix complexity**: Trivial — store timer ID, clear in all resolve/reject paths.

### C2: Event Ordering (client.ts:35-56)

**Root cause**: `frameUpdated` listener + `hasReceivedInitialFramebuffer` flag pattern works but is fragile.
**Findings**: Library has `firstFrameUpdate` event — fires once on initial frame. This eliminates the need for the manual flag entirely.
**Risk**: If `firstFrameUpdate` event behavior differs from `frameUpdated` in edge cases (raw encoding, 8-bit color), fallback needed.
**Fix complexity**: Small — replace `frameUpdated` + flag with `firstFrameUpdate` event listener.

### I1: Per-Call Connection (client.ts:13-21)

**Root cause**: `executeWithConnection` creates → uses → disconnects per tool call.
**Impact**: ~1-3s overhead per tool call. A simple mouse move takes >1s.
**Required approach**:
1. Lazy persistent connection (connect on first tool call)
2. Mutex to serialize concurrent tool calls (VNC is sequential)
3. Auto-reconnect on disconnect
4. Clean disconnect on server shutdown

**Design decisions needed**:
- Mutex implementation: simple promise chain vs. dedicated lock
- Reconnect strategy: exponential backoff vs. immediate
- Connection idle timeout: yes/no, duration
- Health check: ping frame request or just react to disconnect event

### I2+I3: Dead Code (screenshot.ts:118-168)

**Functions never called**: `convertBGRXToRGBA` (29 LOC), `needsPixelFormatConversion` (13 LOC)
**Fix**: Remove both functions. Clean dead code.

### I4: Slow Typing (input.ts:170-173)

**Root cause**: 100ms between-character delay for long/special-char text.
**Analysis**: VNC's reliability depends on timing. The library doesn't buffer key events. However, 100ms is excessive.
**Approach**: Reduce `betweenKeyDelay` from 100ms to 50ms for special chars, 50ms to 30ms for normal chars. Keep the safety margin but 2x faster.

### I5: validateCoordinates with unknown dims (client.ts:96)

**Root cause**: Returns `{ valid: true }` when `screenWidth === 0 || screenHeight === 0`.
**Fix**: Return `{ valid: false }` with clear error message. One-line change.

### I6: Error Swallowing (index.ts:6-14)

**Root cause**: `uncaughtException` handler silently discards VNC compression errors.
**Analysis**: This is a known workaround for `nodejs-rfb` ZRLE bugs. But it also masks other errors.
**Approach**: 
- Add a suppression counter (log every Nth occurrence)
- Check error properties more carefully (only suppress specific known patterns)
- Don't remove the suppression (it prevents crashes), but improve diagnostics

---

## Alternatives

### Alternative A: Persistent connection + mutex (RECOMMENDED)

**Pros**: Minimal latency per call, clean architecture, reuses VNC spec correctly
**Cons**: Adds state management complexity (~80 LOC), needs mutex
**Footprint**: ~100 LOC new code in client.ts

### Alternative B: Keep per-call connection, optimize connection caching

**Pros**: No architectural change, simpler
**Cons**: Still >500ms overhead per call (TCP + RFB handshake is inherently slow), doesn't follow VNC best practices
**Footprint**: 0 LOC (no change)
**Why rejected**: Fundamentally wrong pattern for a remote desktop tool. Every click costs a TCP handshake.

### Alternative C: Connection pool (multiple connections)

**Pros**: Concurrent operations possible (one connection for clicks, one for screenshots)
**Cons**: VNC servers limit connections, framebuffer state can diverge, complex
**Footprint**: ~200 LOC
**Why rejected**: Overengineered. VNC servers have no connection pool concept. MCP tool calls are sequential per client anyway.

---

## Recommendation

**Chosen approach**: Persistent connection + promise-chain mutex (Alternative A)

**Rationale**: VNC is a stateful protocol. Opening/tearing down a connection per operation negates the protocol's design. A single persistent connection with serialized access is the correct architectural model.

**Rejected**: Per-call connection (latency), connection pool (overengineered).

**Risks**:
- Connection drop mid-session → mitigate with auto-reconnect on next call
- Mutex deadlock → mitigate with timeout on lock acquisition
- Memory growth from stale framebuffer → mitigate with periodic frame refresh

---

## Files to change (estimated)

| File | Change | LOC |
|------|--------|-----|
| `src/vnc/client.ts` | Persistent connection, mutex, timer fix, event fix, validateCoords | +60/-30 |
| `src/tools/screenshot.ts` | Remove dead code | -42 |
| `src/tools/input.ts` | Reduce typing delays | ~5 |
| `src/index.ts` | Improve error handler | +10/-5 |
| `src/server.ts` | Add shutdown hook for disconnect | +10 |
| **Total** | | **~+85/-77 ≈ 162 net** |

**Classification**: Large (>150 LOC, architectural decision, touches 5 files)
