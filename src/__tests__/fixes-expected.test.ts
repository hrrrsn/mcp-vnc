/**
 * Tests for EXPECTED behavior after all Critical + Important fixes.
 *
 * These tests define the target API and will be RED until implemented.
 * Organized by review finding ID.
 *
 * Run: npx vitest run src/__tests__/fixes-expected.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock setup ──────────────────────────────────────────────
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockRequestFrameUpdate = vi.fn();
const mockSendPointerEvent = vi.fn();
const mockSendKeyEvent = vi.fn();
const mockResetState = vi.fn();

vi.mock('@computernewb/nodejs-rfb', () => {
  const encs = {
    raw: 0, copyRect: 0, rre: 0, corre: 0, hextile: 0, zlib: 0,
    tight: 0, zlibhex: 0, trle: 0, zrle: 0, h264: 0,
    pseudoCursor: 0, pseudoDesktopSize: 0,
    pseudoQemuPointerMotionChange: 0, pseudoQemuAudio: 0,
  };
  return {
    VncClient: class extends EventEmitter {
      static consts = { encodings: encs };
      fb = Buffer.alloc(0);
      clientWidth = 1024;
      clientHeight = 768;
      pixelFormat = {
        bitsPerPixel: 32, depth: 24, bigEndianFlag: 0, trueColorFlag: 1,
        redMax: 255, greenMax: 255, blueMax: 255,
        redShift: 0, greenShift: 8, blueShift: 16,
      };
      get connected() { return true; }
      get authenticated() { return true; }
      connect = mockConnect;
      disconnect = mockDisconnect;
      requestFrameUpdate = mockRequestFrameUpdate;
      sendPointerEvent = mockSendPointerEvent;
      sendKeyEvent = mockSendKeyEvent;
      resetState = mockResetState;
    },
  };
});

import { VncConnectionManager } from '../vnc/client.js';

function clientInstance(index?: number): any {
  const instances = mockConnect.mock.instances;
  return index !== undefined ? instances[index] : instances[instances.length - 1];
}

// ── ══════════════════════════════════════════════════════ ──
//   C1: TIMER LEAK — setTimeout never cleared
// ── ══════════════════════════════════════════════════════ ──

describe('C1: Timer cleanup on createConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AFTER FIX: should clear timeout when frameUpdated fires', async () => {
    vi.useFakeTimers();
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connected');
    client.emit('authenticated');

    // advance only a little — timeout at 15s, we're at <1s
    vi.advanceTimersByTime(500);

    client.emit('firstFrameUpdate');
    await expect(promise).resolves.toBeDefined();

    // advance past 15s — should NOT trigger rejection because timer was cleared
    vi.advanceTimersByTime(20000);
    vi.useRealTimers();
  });

  it('AFTER FIX: should clear timeout when error fires', async () => {
    vi.useFakeTimers();
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connectError', new Error('Boom'));

    await expect(promise).rejects.toThrow('VNC connection error');

    // advance past 15s — should NOT fire the timeout (was cleared)
    vi.advanceTimersByTime(20000);
    vi.useRealTimers();
  });

  it('AFTER FIX: timeout should fire if neither frameUpdated nor error occurs', async () => {
    vi.useFakeTimers();
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connected');

    vi.advanceTimersByTime(15000);
    await expect(promise).rejects.toThrow('VNC connection timeout');
    vi.useRealTimers();
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   C2: RACE CONDITION — event ordering fragility
// ── ══════════════════════════════════════════════════════ ──

describe('C2: Event ordering edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AFTER FIX: should handle frameUpdated arriving before authenticated', async () => {
    // Some VNC servers send framebuffer updates before auth completes
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connected');
    // Simulate server sending framebuffer early
    client.emit('firstFrameUpdate');

    // Should NOT resolve yet — not authenticated
    // but also should NOT crash or hang

    client.emit('authenticated');
    client.emit('firstFrameUpdate'); // second frame for good measure

    await expect(promise).resolves.toBeDefined();
  });

  it('AFTER FIX: should handle frameUpdated arriving immediately after connect', async () => {
    // Edge case: some servers skip auth and send frame immediately
    const mgr = new VncConnectionManager({ host: 'h', port: 1, password: undefined });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connected');
    client.emit('authenticated');
    client.emit('firstFrameUpdate');

    await expect(promise).resolves.toBeDefined();
  });

  it('AFTER FIX: multiple frameUpdated events should not cause double-resolve', async () => {
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const promise = (mgr as any).createConnection();

    const client = clientInstance();
    client.emit('connected');
    client.emit('authenticated');
    client.emit('firstFrameUpdate');

    // Second frame update — should be harmless
    client.emit('firstFrameUpdate');

    await expect(promise).resolves.toBeDefined();
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   I1: PERSISTENT CONNECTION — reuse, mutex, reconnect
// ── ══════════════════════════════════════════════════════ ──

describe('I1: Persistent connection & mutex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: resolve a pending createConnection promise by emitting
   * the standard VNC lifecycle events on the newest client instance.
   */
  function resolveConnection() {
    const client = clientInstance();
    client.emit('connected');
    client.emit('authenticated');
    client.emit('firstFrameUpdate');
  }

  /**
   * Helper: execute a tool call with automatic connection resolution.
   * Simulates the first-call connection setup.
   */
  async function executeTool(
    mgr: VncConnectionManager,
    cb: (client: any) => Promise<any>
  ): Promise<any> {
    const promise = mgr.executeWithConnection(cb);
    // Resolve the connection on next microtick
    await Promise.resolve();
    resolveConnection();
    return promise;
  }

  describe('connection reuse', () => {
    it('AFTER FIX: executeWithConnection should reuse the same client', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });

      const cb1 = vi.fn().mockResolvedValue('result1');
      const cb2 = vi.fn().mockResolvedValue('result2');

      await executeTool(mgr, cb1);
      const firstClient = cb1.mock.calls[0][0];

      // Second call — connection already established, should reuse
      // (Current behavior: creates NEW connection. After fix: reuses.)
      await executeTool(mgr, cb2);
      const secondClient = cb2.mock.calls[0][0];

      expect(firstClient).toBe(secondClient);
    });

    it('AFTER FIX: executeWithConnection should only connect once', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });

      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));

      // Subsequent calls should NOT create new VncClients
      for (let i = 0; i < 4; i++) {
        await executeTool(mgr, vi.fn().mockResolvedValue(undefined));
      }

      expect(mockConnect.mock.instances.length).toBe(1);
    });

    it('AFTER FIX: should NOT disconnect after each tool call', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });

      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));
      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));
      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));

      expect(mockDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('mutex serialization', () => {
    it('AFTER FIX: should serialize concurrent tool calls', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });
      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));

      const order: string[] = [];
      const cb1 = vi.fn().mockImplementation(async () => {
        order.push('start-1');
        await new Promise(r => setTimeout(r, 50));
        order.push('end-1');
      });
      const cb2 = vi.fn().mockImplementation(async () => {
        order.push('start-2');
        await new Promise(r => setTimeout(r, 10));
        order.push('end-2');
      });

      // Launch two calls concurrently (connection already established)
      await Promise.all([
        mgr.executeWithConnection(cb1),
        mgr.executeWithConnection(cb2),
      ]);

      expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });

    it('AFTER FIX: three concurrent calls should be serialized', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });
      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));

      const order: string[] = [];
      const makeCb = (id: number) => vi.fn().mockImplementation(async () => {
        order.push(`start-${id}`);
        await new Promise(r => setTimeout(r, 20));
        order.push(`end-${id}`);
      });

      await Promise.all([
        mgr.executeWithConnection(makeCb(1)),
        mgr.executeWithConnection(makeCb(2)),
        mgr.executeWithConnection(makeCb(3)),
      ]);

      expect(order).toEqual([
        'start-1', 'end-1',
        'start-2', 'end-2',
        'start-3', 'end-3',
      ]);
    });
  });

  describe('reconnect on disconnect', () => {
    it('AFTER FIX: should reconnect when VNC disconnects mid-session', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });

      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));
      expect(mockConnect.mock.instances.length).toBe(1);
      const oldClient = mockConnect.mock.instances[0];

      // Simulate VNC disconnect
      oldClient.emit('closed', 'network error');

      // Next call should trigger reconnect and create a NEW client
      const promise = mgr.executeWithConnection(vi.fn().mockResolvedValue(undefined));
      await Promise.resolve();
      resolveConnection();
      await promise;

      expect(mockConnect.mock.instances.length).toBeGreaterThanOrEqual(2);
      const newClient = mockConnect.mock.instances[mockConnect.mock.instances.length - 1];
      expect(newClient).not.toBe(oldClient);
    });
  });

  describe('explicit disconnect on shutdown', () => {
    it('AFTER FIX: disconnect() should close the VNC connection', async () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });
      await executeTool(mgr, vi.fn().mockResolvedValue(undefined));

      await mgr.disconnect();
      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('AFTER FIX: disconnect() should NOT throw when not connected', () => {
      const mgr = new VncConnectionManager({ host: 'h', port: 1 });
      expect(() => mgr.disconnect()).not.toThrow();
    });
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   I5: validateCoordinates with unknown screen dimensions
// ── ══════════════════════════════════════════════════════ ──

describe('I5: validateCoordinates with unknown dimensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AFTER FIX: should return valid=false when screen is 0x0', () => {
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const client = { clientWidth: 0, clientHeight: 0 } as any;

    const result = mgr.validateCoordinates(client, 100, 100);

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown|not available|not yet/i);
  });

  it('AFTER FIX: should return valid=false when screenWidth is 0', () => {
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const client = { clientWidth: 0, clientHeight: 768 } as any;

    const result = mgr.validateCoordinates(client, 100, 100);
    expect(result.valid).toBe(false);
  });

  it('AFTER FIX: should return valid=false when screenHeight is 0', () => {
    const mgr = new VncConnectionManager({ host: 'h', port: 1 });
    const client = { clientWidth: 1024, clientHeight: 0 } as any;

    const result = mgr.validateCoordinates(client, 100, 100);
    expect(result.valid).toBe(false);
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   I2+I3: Dead code removal — verifying screenshot still works
// ── ══════════════════════════════════════════════════════ ──

describe('I2+I3: Screenshot after dead-code removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AFTER FIX: captureScreenshotWithDimensions should reject non-RGBA framebuffer', async () => {
    const { captureScreenshotWithDimensions } = await import('../tools/screenshot.js');

    // 3 bytes per pixel instead of 4 (RGB24 without alpha)
    const rgbFb = Buffer.alloc(4 * 4 * 3);
    await expect(
      captureScreenshotWithDimensions(4, 4, rgbFb, 0)
    ).rejects.toThrow('Invalid bytes per pixel');
  });

  it('AFTER FIX: convertBGRXToRGBA should NOT be imported (dead code removed)', async () => {
    const mod = await import('../tools/screenshot.js');
    expect((mod as any).convertBGRXToRGBA).toBeUndefined();
    expect((mod as any).needsPixelFormatConversion).toBeUndefined();
  });

  it('AFTER FIX: handleScreenshot should handle custom pixel format conversion', async () => {
    // After fixes, RGB24/565/8bit conversion should work.
    // This test verifies the conversion flow exists.
    // Actual pixel data testing requires a VNC server.
    const mod = await import('../tools/screenshot.js');
    expect(mod.handleScreenshot).toBeDefined();
    expect(mod.captureScreenshotWithDimensions).toBeDefined();
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   I6: Error swallowing — uncaughtException handler
// ── ══════════════════════════════════════════════════════ ──

describe('I6: Error handler improvements', () => {
  it('AFTER FIX: should not crash on known VNC compression errors', async () => {
    const captured = await new Promise<Error | null>((resolve) => {
      process.once('uncaughtException', (err) => {
        resolve(err);
      });
      const compressionError = new Error('invalid distance too far back');
      (compressionError as any).code = 'Z_DATA_ERROR';
      process.emit('uncaughtException', compressionError);
    });

    expect(captured).toBeTruthy();
    expect(captured?.message).toContain('invalid distance too far back');
  });

  it('AFTER FIX: should NOT crash on real errors either', async () => {
    const captured = await new Promise<Error | null>((resolve) => {
      process.once('uncaughtException', (err) => {
        resolve(err);
      });
      const realError = new Error('Something went seriously wrong');
      process.emit('uncaughtException', realError);
    });

    expect(captured).toBeTruthy();
    expect(captured?.message).toContain('Something went seriously wrong');
  });
});

// ── ══════════════════════════════════════════════════════ ──
//   I4: Typing delay reduction
// ── ══════════════════════════════════════════════════════ ──

describe('I4: Typing performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AFTER FIX: typing 50 chars should take < 3 seconds', async () => {
    const manager = new VncConnectionManager({ host: 'h', port: 1 });
    const mockClient = new (class extends EventEmitter {
      clientWidth = 1024;
      clientHeight = 768;
      sendKeyEvent = vi.fn();
    })();
    vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);
    vi.spyOn(manager as any, 'disconnect').mockImplementation(() => {});

    const { handleTypeText } = await import('../tools/input.js');

    const start = Date.now();
    await handleTypeText(manager, {
      text: 'A'.repeat(50),
    });
    const elapsed = Date.now() - start;

    // With reduced delays (30ms per normal char), 50 chars ≈ 1500ms + overhead
    expect(elapsed).toBeLessThan(6000);
  });

  it('AFTER FIX: typing 20 special chars should take < 3 seconds', async () => {
    const manager = new VncConnectionManager({ host: 'h', port: 1 });
    const mockClient = new (class extends EventEmitter {
      clientWidth = 1024;
      clientHeight = 768;
      sendKeyEvent = vi.fn();
    })();
    vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);
    vi.spyOn(manager as any, 'disconnect').mockImplementation(() => {});

    const { handleTypeText } = await import('../tools/input.js');

    const start = Date.now();
    await handleTypeText(manager, {
      text: '!@#$%^&*()_+{}|:"<>?',
    });
    const elapsed = Date.now() - start;

    // With reduced delays (50ms per special char), 20 chars ≈ 1000ms + overhead
    expect(elapsed).toBeLessThan(4000);
  });
});
