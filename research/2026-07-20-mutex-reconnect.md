# Research: Persistent Connection Implementation

**Date**: 2026-07-20
**Goal**: Determine exact API/event contract of `@computernewb/nodejs-rfb` library to implement persistent connection with mutex
**Time box**: 30 min (Large)

---

## Codebase Findings

### Library event contract (from dist/index.js source)

| Event emitted by lib | What triggers it | Handler in current code? |
|---|---|---|
| `connected` | TCP connect | Yes (L37) |
| `authenticated` | Auth complete | Yes (L41) |
| `authError` | Auth failed | No (missing) |
| `connectError` | TCP error | No — uses `error` event instead |
| `connectTimeout` | TCP timeout | No (missing) |
| `firstFrameUpdate` | First frame + fb arg | **NO** — uses `frameUpdated` instead |
| `frameUpdated` | Every frame + fb arg | Yes (L50) |
| `closed` | TCP socket close | No — listens for `disconnect` instead |
| `disconnected` | `disconnect()` called | No — listens for `disconnect` instead |

**CRITICAL**: Current code at L64 listens for `'disconnect'` — **this event does not exist**. The library emits `'closed'` (TCP close) and `'disconnected'` (explicit disconnect). The disconnect handler is dead code.

### Library `disconnect()` (L1286-1291)
```
this._connection?.end()  → emits 'closed'
this.resetState()        → clears all state, _firstFrameReceived = false
this.emit('disconnected')
```

### Library `resetState()` (L1757)
Clears: `_firstFrameReceived`, `_connected`, `_authenticated`, `clientWidth`, `clientHeight`, `pixelFormat`, `_frameBufferReady` etc.

**Implication**: After disconnect → reconnect, `firstFrameUpdate` fires again. We can use this as our connection-ready signal.

### Library auto-frame-request loop (L1717-1719)
When `_fps === 0` (default), after processing each frame update, the library auto-requests the next frame. This means the connection stays "alive" without manual `requestFrameUpdate` polling.

---

## Mutex Design Options

### Option A: Promise-chain mutex (RECOMMENDED)

```
private mutex: Promise<void> = Promise.resolve();

async executeWithConnection<T>(cb: (c: VncClient) => Promise<T>): Promise<T> {
  const prev = this.mutex;
  let release!: () => void;
  this.mutex = new Promise<void>(resolve => { release = resolve; });
  await prev;
  try {
    const client = await this.ensureConnected();
    return await cb(client);
  } finally {
    release();
  }
}
```

**Pros**: 0 dependencies, 5 lines, always releases (finally), naturally serializes
**Cons**: If callback hangs, entire chain deadlocks. Mitigation: add timeout.
**Footprint**: +5 LOC in `executeWithConnection`

### Option B: Explicit lock class

```
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;
  async acquire() { if (this.locked) await new Promise(r => this.queue.push(r)); this.locked = true; }
  release() { if (this.queue.length) this.queue.shift()!(); else this.locked = false; }
}
```

**Pros**: More explicit, can add deadlock detection
**Cons**: More code, manual acquire/release, easy to forget release
**Footprint**: +15 LOC
**Why rejected**: Promise-chain is simpler and `finally` guarantees release. No benefit from explicit lock for single-consumer VNC.

### Option C: Named lock with timeout (alternative)

Same as A, but wrap callback with `Promise.race([cb(client), timeout(30000)])`.

**Pros**: Prevents deadlock from hung callbacks
**Cons**: Adds complexity
**Footprint**: +8 LOC
**Decision**: Include as `Promise.race` with 30s per-operation timeout.

---

## Reconnect Strategy

### Option A: Lazy reconnect on next call (RECOMMENDED)

After disconnect: set `client = null`, `connecting = null`. On next `executeWithConnection`: `ensureConnected()` creates new connection.
**Pros**: Simple, no background timers, no reconnect storms
**Cons**: Next call after disconnect pays the 1-3s connection cost

### Option B: Auto-reconnect with exponential backoff

On disconnect: start reconnecting immediately with backoff (1s, 2s, 4s...).
**Pros**: Connection restored before next tool call
**Cons**: Wastes resources reconnecting during idle periods, complex state machine

**Why B rejected**: MCP tool calls are user-initiated. If VNC dies, the user will notice from a tool error. Auto-reconnect makes failures less observable.

---

## Event listener cleanup

Current `createConnection` adds 5 `.on()` handlers but never removes them. After reconnect, old listeners would fire on the new client.

**Fix**: Use `.once()` where appropriate, or store handler references and call `.off()` before reconnect.

- `connected` → `.once()` ✅
- `authenticated` → `.once()` ✅  
- `firstFrameUpdate` → `.once()` ✅
- `connectError` → `.once()` ✅
- `closed` → keep `.on()` for persistent disconnect detection

---

## Recommendation

**Chosen approach**: Promise-chain mutex + `firstFrameUpdate` as ready signal + lazy reconnect + `.once()` for one-shot handlers

**Rationale**: Promise-chain is the simplest serialization primitive that works with `try/finally`. `firstFrameUpdate` eliminates the fragile `hasReceivedInitialFramebuffer` flag. Lazy reconnect avoids complexity.

**Risks**:
- Callback hang deadlocks chain → mitigate with `Promise.race(timeout)`
- `firstFrameUpdate` event behavior may differ on some servers → fallback to `frameUpdated` with flag (keep current logic as backup)

**Implementation order** (5 files, ~160 LOC):
1. `client.ts` — full rewrite of `VncConnectionManager` (persistent + mutex + timer fix + event fix + validateCoords)
2. `screenshot.ts` — remove dead code
3. `input.ts` — reduce delays
4. `index.ts` — improve error handler
5. `server.ts` — add shutdown disconnect
