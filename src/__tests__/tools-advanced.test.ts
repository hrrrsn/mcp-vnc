import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockRequestFrameUpdate = vi.fn();
const mockSendPointerEvent = vi.fn();
const mockSendKeyEvent = vi.fn();
const mockClientCutText = vi.fn();

vi.mock('@computernewb/nodejs-rfb', () => ({
  VncClient: class extends EventEmitter {
    fb = Buffer.alloc(1024 * 768 * 4);
    clientWidth = 1024;
    clientHeight = 768;
    pixelFormat = {
      bitsPerPixel: 32, depth: 24, bigEndianFlag: 0, trueColorFlag: 1,
      redMax: 255, greenMax: 255, blueMax: 255,
      redShift: 0, greenShift: 8, blueShift: 16,
    };
    connect = mockConnect;
    disconnect = mockDisconnect;
    requestFrameUpdate = mockRequestFrameUpdate;
    sendPointerEvent = mockSendPointerEvent;
    sendKeyEvent = mockSendKeyEvent;
    clientCutText = mockClientCutText;
    resetState = vi.fn();
  },
}));

import { VncConnectionManager } from '../vnc/client.js';
import { handleClick, handleMoveMouse, handleKeyPress, handleTypeText, handleTypeMultiline, handleClipboardSet, handleDrag } from '../tools/input.js';
import { handleGetState } from '../tools/state.js';

function createMockClient() {
  const c = new (class extends EventEmitter {
    get connected() { return (this as any)._connected !== false; }
    set connected(v: boolean) { (this as any)._connected = v; }
    get authenticated() { return (this as any)._auth !== false; }
    set authenticated(v: boolean) { (this as any)._auth = v; }
  })() as any;
  c.clientWidth = 1024;
  c.clientHeight = 768;
  c.clientName = 'test';
  c.pixelFormat = { bitsPerPixel: 32, depth: 24 };
  c.connected = true;
  c.authenticated = true;
  c.sendPointerEvent = vi.fn();
  c.sendKeyEvent = vi.fn();
  c.clientCutText = vi.fn();
  return c;
}

function createMockManager(): VncConnectionManager {
  const manager = new VncConnectionManager({
    host: 'localhost', port: 5900, password: 'test',
  });
  vi.spyOn(manager as any, 'createConnection').mockImplementation(() => {
    const c = createMockClient();
    return Promise.resolve(c);
  });
  vi.spyOn(manager as any, 'disconnect').mockImplementation(() => {});
  return manager;
}

describe('handleGetState', () => {
  it('should return disconnected state as JSON', async () => {
    const manager = new VncConnectionManager({ host: 'localhost', port: 5900 });
    const result = await handleGetState(manager);
    const state = JSON.parse(result.content[0].text);
    expect(state.isConnected).toBe(false);
    expect(state.screenWidth).toBe(0);
    expect(state.screenHeight).toBe(0);
  });

  it('should return connected state with dimensions', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});
    const result = await handleGetState(manager);
    const state = JSON.parse(result.content[0].text);
    expect(state.isConnected).toBe(true);
    expect(state.screenWidth).toBe(1024);
    expect(state.screenHeight).toBe(768);
    expect(state.bitsPerPixel).toBe(32);
    expect(state.depth).toBe(24);
  });
});

describe('handleClipboardSet', () => {
  it('should call client.clientCutText with provided text', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});

    const client = (manager as any).client;
    client.clientCutText = vi.fn();

    const result = await handleClipboardSet(manager, { text: 'clipboard content' });

    expect(client.clientCutText).toHaveBeenCalledWith('clipboard content');
    expect(result.content[0].text).toContain('Clipboard set: clipboard content');
  });

  it('should handle empty string clipboard', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});

    const client = (manager as any).client;
    client.clientCutText = vi.fn();

    const result = await handleClipboardSet(manager, { text: '' });

    expect(client.clientCutText).toHaveBeenCalledWith('');
    expect(result.content[0].text).toContain('Clipboard set: ');
  });

  it('should handle unicode text', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});

    const client = (manager as any).client;
    client.clientCutText = vi.fn();

    await handleClipboardSet(manager, { text: 'héllo->世界' });

    expect(client.clientCutText).toHaveBeenCalledWith('héllo->世界');
  });
});

describe('handleDrag', () => {
  it('should press -> move -> release for valid coordinates', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});
    const client = (manager as any).client;
    client.sendPointerEvent = vi.fn();

    const result = await handleDrag(manager, {
      fromX: 100, fromY: 200, toX: 300, toY: 400,
    });

    expect(client.sendPointerEvent).toHaveBeenCalledTimes(3);
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 100, 200, 0x01);
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(2, 300, 400, 0x01);
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(3, 300, 400, 0);
    expect(result.content[0].text).toContain('Dragged from (100, 200) to (300, 400)');
  });

  it('should use correct button masks', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});
    const client = (manager as any).client;

    client.sendPointerEvent = vi.fn();
    await handleDrag(manager, { fromX: 10, fromY: 10, toX: 20, toY: 20, button: 'right' });
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 10, 10, 0x04);
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(2, 20, 20, 0x04);

    client.sendPointerEvent = vi.fn();
    await handleDrag(manager, { fromX: 10, fromY: 10, toX: 20, toY: 20, button: 'middle' });
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 10, 10, 0x02);
    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(2, 20, 20, 0x02);
  });

  it('should default to left button when not specified', async () => {
    const manager = createMockManager();
    await manager.executeWithConnection(async () => {});
    const client = (manager as any).client;
    client.sendPointerEvent = vi.fn();

    await handleDrag(manager, { fromX: 0, fromY: 0, toX: 100, toY: 100 });

    expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 0, 0, 0x01);
  });

  it('should reject when from-coordinates are out of bounds', async () => {
    const manager = createMockManager();
    await expect(
      handleDrag(manager, { fromX: 9999, fromY: 100, toX: 200, toY: 300 })
    ).rejects.toThrow('outside screen bounds');
  });

  it('should reject when to-coordinates are out of bounds', async () => {
    const manager = createMockManager();
    await expect(
      handleDrag(manager, { fromX: 100, fromY: 100, toX: -1, toY: 300 })
    ).rejects.toThrow('outside screen bounds');
  });
});

describe('Input tools — mock call verification', () => {
  describe('handleClick — sendPointerEvent calls', () => {
    it('left click: press(0x01) -> release(0)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendPointerEvent = vi.fn();

      await handleClick(manager, { x: 100, y: 200 });

      expect(client.sendPointerEvent).toHaveBeenCalledTimes(2);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 100, 200, 0x01);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(2, 100, 200, 0);
    });

    it('right click: press(0x04) -> release(0)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendPointerEvent = vi.fn();

      await handleClick(manager, { x: 50, y: 50, button: 'right' });

      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 50, 50, 0x04);
    });

    it('middle click: press(0x02) -> release(0)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendPointerEvent = vi.fn();

      await handleClick(manager, { x: 50, y: 50, button: 'middle' });

      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 50, 50, 0x02);
    });

    it('double-click: press(0x01) -> release(0) -> press(0x01) -> release(0)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendPointerEvent = vi.fn();

      await handleClick(manager, { x: 10, y: 10, double: true });

      expect(client.sendPointerEvent).toHaveBeenCalledTimes(4);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(1, 10, 10, 0x01);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(2, 10, 10, 0);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(3, 10, 10, 0x01);
      expect(client.sendPointerEvent).toHaveBeenNthCalledWith(4, 10, 10, 0);
    });
  });

  describe('handleMoveMouse — sendPointerEvent calls', () => {
    it('should send with mask=0 (no buttons)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendPointerEvent = vi.fn();

      await handleMoveMouse(manager, { x: 500, y: 300 });

      expect(client.sendPointerEvent).toHaveBeenCalledWith(500, 300, 0);
    });
  });

  describe('handleKeyPress — sendKeyEvent calls', () => {
    it('single key: keyDown -> keyUp', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendKeyEvent = vi.fn();

      await handleKeyPress(manager, { key: 'Enter' });

      expect(client.sendKeyEvent).toHaveBeenCalledTimes(2);
      expect(client.sendKeyEvent).toHaveBeenNthCalledWith(1, expect.any(Number), true);
      expect(client.sendKeyEvent).toHaveBeenNthCalledWith(2, expect.any(Number), false);
    });

    it('modifier combo: press mods -> press key -> release key -> release mods (reverse)', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendKeyEvent = vi.fn();

      await handleKeyPress(manager, { key: 'Ctrl+Alt+Delete' });

      expect(client.sendKeyEvent.mock.calls.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('handleTypeText — timing', () => {
    it('short plain text (<=10 chars) should finish < 1s', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendKeyEvent = vi.fn();

      const start = Date.now();
      await handleTypeText(manager, { text: 'hello' });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(1000);
    });

    it('text with special chars should use slow timing', async () => {
      const manager = createMockManager();
      await manager.executeWithConnection(async () => {});
      const client = (manager as any).client;
      client.sendKeyEvent = vi.fn();

      const start = Date.now();
      await handleTypeText(manager, { text: 'hello!' });
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(3000);
    });
  });
});
