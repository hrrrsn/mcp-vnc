# ADR-001: Use Persistent VNC Connection with Mutex Serialization

**Status**: Accepted
**Date**: 2026-07-20
**Deciders**: opencode + dspilarov

## Context

`VncConnectionManager.executeWithConnection()` currently creates a fresh VNC connection for every tool call — mouse click, keypress, screenshot — then disconnects immediately. Each connection involves:

1. TCP handshake (~50ms)
2. RFB protocol version negotiation (~100ms)
3. Authentication handshake (~200ms)
4. Full framebuffer request + wait for frame update (~500-2000ms)
5. Tool operation (<10ms)
6. Disconnect

Total overhead: **1-3 seconds per tool call**. A workflow involving 5 operations (move → click → type → screenshot) takes 10+ seconds, 95% of which is connection setup/teardown.

The VNC protocol (RFC 6143) is designed for persistent sessions. Opening short-lived connections per operation violates the protocol's assumptions and causes unacceptable latency.

### Bugs found in source analysis

**Timer leak**: `setTimeout` for 15s connection timeout (L77-79) is never cleared on success — stale timer stays in heap.

**Dead disconnect listener**: Current code listens for `'disconnect'` event (L64), but the `@computernewb/nodejs-rfb@0.4.2` library emits `'closed'` (TCP close) and `'disconnected'` (explicit disconnect). The `'disconnect'` event does not exist. The disconnect handler is dead code — disconnects are never detected.

**Error event mismatch**: Code listens for `'error'` (L58) but library emits `'connectError'` with the error as argument.

**`firstFrameUpdate` available**: Library emits `firstFrameUpdate(fb)` on the initial frame. Using this eliminates the fragile `hasReceivedInitialFramebuffer` flag.

**Auto frame-request loop**: After processing each update, the library auto-requests the next frame (when `_fps === 0`, the default). No manual polling needed — the connection stays "alive" automatically.

## Decision

**We will replace per-call connections with a single lazy-initialized persistent VNC connection, serializing all tool calls through a promise-chain mutex, with lazy reconnection on disconnect.**

### Mutex: Promise-chain (not explicit lock class)

```typescript
private mutex: Promise<void> = Promise.resolve();

async executeWithConnection<T>(cb: (c: VncClient) => Promise<T>): Promise<T> {
  const prev = this.mutex;
  let release!: () => void;
  this.mutex = new Promise<void>(r => { release = r; });
  await prev;  // wait for previous operation
  try {
    return await cb(await this.ensureConnected());
  } finally {
    release();  // always release, even on error
  }
}
```

**Why promise-chain over explicit lock**: 5 lines vs 15. `try/finally` guarantees release. For a single-consumer VNC protocol, no deadlock detection is needed. A 30s per-operation timeout prevents hangs.

### Events: `.once()` for one-shot handlers

- `connected` → `.once()` — resolve connection promise
- `authenticated` → `.once()` — trigger frame request
- `firstFrameUpdate` → `.once()` — mark ready
- `connectError` → `.once()` — reject with error
- `closed` → `.on()` — persistent (handle disconnect)

This prevents listener accumulation on reconnect.

### Reconnect: Lazy (not auto-background)

On disconnect: `client = null; connecting = null`. Next tool call transparently reconnects. No background timers, no reconnect storms.

### Rationale

1. **VNC is stateful**: The framebuffer, pixel format, and encoding state are negotiated once per session.
2. **MCP is single-client sequential**: Concurrent tool calls are impossible within one session.
3. **`.once()` + `.off()` prevents leaks**: Listener accumulation on reconnect is the #1 memory leak cause in EventEmitter-based code.

## Alternatives Considered

### Option A: Persistent connection + promise-chain mutex (CHOSEN)

- **Pros**: Near-zero latency per tool call, clean architecture, standard VNC usage
- **Cons**: Adds ~80 LOC of state management, mutex logic
- **Why chosen**: Correct model for stateful protocol, minimal overhead

### Option B: Keep per-call connection (status quo)

- **Pros**: No code changes, stateless (connection failures isolated per call)
- **Cons**: 1-3s latency per call, wastes server resources, doesn't follow VNC spec
- **Why rejected**: Unacceptable performance for interactive remote desktop control

### Option C: Connection pool (multiple persistent connections)

- **Pros**: Theoretically enables concurrent operations
- **Cons**: Most VNC servers limit concurrent connections, framebuffer state can diverge between connections, 2-3x memory per connection, MCP doesn't support concurrent tool calls per server
- **Why rejected**: Overengineered; no real concurrency benefit given MCP architecture

## Consequences

### Positive
- Tool call latency drops from 1-3s to <50ms (excluding screenshot encoding)
- Reduced server load (one TCP connection, one VNC session)
- Cleaner error handling (connection errors handled once, not per-call)
- `firstFrameUpdate` event eliminates fragile flag-based tracking

### Negative
- Connection drops affect all subsequent calls until reconnect completes
- Mutex serialization prevents parallel operations (acceptable — MCP is sequential)
- Stateful design requires explicit cleanup on server shutdown
- **Mitigation**: Auto-reconnect with transparent retry; disconnect handler in server shutdown

### Neutral
- `server.ts` must call `vncManager.disconnect()` on shutdown (new concern)
- Test framework (`test.ts`) must account for persistent connection lifecycle

## Compliance

- Code review checklist: verify `clearTimeout` is always called in connection handlers
- Test: `test.ts` must verify multiple tool calls succeed on a single server instance
- Lint: TypeScript strict mode enforces proper async/await handling
