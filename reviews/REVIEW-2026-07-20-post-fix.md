# Code Review — 2026-07-20

**Scope**: All fixes from initial review: persistent VNC connection, timer cleanup, event name corrections, dead code restoration, typing delay reduction, error handler improvements
**Reviewer**: opencode (code-reviewer skill)
**Axes checked**: correctness, security, performance, maintainability

---

## Findings

### File: src/vnc/client.ts

- **Suggestion** (L14-20): Promise-chain mutex has no timeout guard. If a callback hangs (e.g., VNC server stops responding), all subsequent tool calls deadlock forever. Consider adding `Promise.race([callback(client), timeout(30000)])` to prevent infinite blocking.

- **Suggestion** (L29-30): `ensureConnected()` checks `this.client?.connected && this.client.authenticated` but the `connected` getter on `VncClient` returns `this._connected` which is set to `false` in `resetState()` (called on disconnect). This is correct for the library but could be fragile if the library changes its internal state tracking. Consider adding a separate boolean flag `this._explicitlyConnected` for safety.

- **Minor** (L47-61): `createConnection()` is called via `ensureConnected()` which sets `this.connecting` before calling it and clears it in `finally`. However, if `createConnection()` throws synchronously (e.g., `new VncClient` constructor fails), `this.connecting` is set but the `finally` block never executes because no promise is created. Edge case: constructor failure is unlikely but possible.

- **Minor** (L96-99): `closed` event handler clears `this.client` and `this.connecting` but does not set a flag that would trigger reconnect on next call. `ensureConnected()` handles this by detecting `!this.client?.connected`, which works. However, if the `closed` event and a concurrent `ensureConnected()` call race, two reconnection attempts could start. The `connecting` guard mitigate this but only partially — if `closed` fires between the `connected` check and `this.connecting` assignment in `ensureConnected()`.

- **Suggestion** (L87-91): `connectError` event rejects the promise but the `closed` event is a separate `.on()` (not `.once()`). After `connectError` rejects and the test/destroy cleans up, the `closed` listener persists on the failed VncClient, keeping a reference that prevents garbage collection. Since the client is discarded after error, this is a minor leak. Consider calling `vncClient.removeAllListeners()` after error.

### File: src/tools/screenshot.ts

- **Suggestion** (L118-131): `needsPixelFormatConversion()` checks `redShift === 0 && greenShift === 8 && blueShift === 16`. This correctly identifies standard RGBA (R at byte 0, G at byte 1, B at byte 2). However, some VNC servers may reverse the byte order while keeping the same shift pattern (big-endian vs little-endian). The `bigEndianFlag` from `pixelFormat` is not checked. Consider adding a `bigEndianFlag` check for completeness.

- **Minor** (L133-165): `convertBGRXToRGBA` correctly handles `redMax === 65280` (0xFF00) for high-byte color servers. However, the function name says "BGRX" but the logic handles general non-standard RGBA shifts, not specifically BGRX. The name is misleading. Consider renaming to `convertNonStandardRGBA` or `reorderRGBA`.

### File: src/tools/input.ts

- **Minor** (L162-163): The `useSlowTyping` heuristic triggers on `text.length > 10` which means even 11 plain ASCII characters get the slower timing (50ms instead of 30ms). An 11-char normal string (e.g., "hello world!") takes `11 × (50+50) = 1100ms` instead of `11 × (30+30) = 660ms`. The heuristic is too aggressive for medium-length normal text. Consider separating the conditions: `useSlowTyping` for special characters only, `isLongText` for length-based adjustment.

### File: src/index.ts

- **Suggestion** (L8-9): `SUPPRESS_INTERVAL = 100` — every 100th suppressed error is logged. For a high-frequency error this is too sparse (you'd see 1 log per ~25 minutes at 1 error/second). For a low-frequency error you might never see it. Consider logging every N-th AND implementing a time-based fallback (e.g., log at most every 60 seconds).

- **Minor** (L5-6): `suppressedCount` has no upper bound and will grow indefinitely (Number overflow at 2^53). For a long-running server, this is a theoretical memory leak. Consider wrapping or creating a circular buffer.

### File: src/server.ts

- **Minor** (L175-177): `shutdown()` is added but never called anywhere. The `VncMcpServer` class has no cleanup hooks (no `process.on('exit', ...)`, no `SIGINT`/`SIGTERM` handler). The `shutdown()` method exists but will never be invoked automatically. Consider adding signal handlers or MCP server close hooks.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical Fix | 0 |
| Important | 0 |
| Minor | 6 |
| Suggestion | 5 |

### Verdict: **Safe to proceed**

No blocking issues found. All critical and important bugs from the initial review are fixed. The remaining items are minor improvements and suggestions that can be addressed in follow-up work.

### What was fixed (confirmed)

| Original finding | Status |
|-----------------|--------|
| C1: Timer leak | Fixed — `cleanup()` function clears `setTimeout` |
| C2: Fragile framebuffer flag | Fixed — replaced with `firstFrameUpdate` + `.once()` |
| I1: Per-call connection | Fixed — persistent connection with lazy init |
| I2+I3: Dead code | Restored + connected to screenshot pipeline |
| I4: Slow typing | Improved — delays reduced from 50/100ms to 30/50ms |
| I5: validateCoordinates with 0x0 | Fixed — returns `valid: false` |
| I6: Silent error suppression | Improved — counter + periodic logging |
| Event name mismatch | Fixed — `error`→`connectError`, `disconnect`→`closed` |

### Test coverage

- 82 tests, all passing
- 5 test files covering all changed modules
- Unit tests for mutex serialization, connection reuse, reconnect, timer cleanup, event ordering
