import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockRequestFrameUpdate = vi.fn();
const mockSendPointerEvent = vi.fn();
const mockSendKeyEvent = vi.fn();

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
      get connected() { return (this as any)._c || false; }
      set connected(v: boolean) { (this as any)._c = v; }
      get authenticated() { return (this as any)._a || false; }
      set authenticated(v: boolean) { (this as any)._a = v; }
      connect = mockConnect;
      disconnect = mockDisconnect;
      requestFrameUpdate = mockRequestFrameUpdate;
      sendPointerEvent = mockSendPointerEvent;
      sendKeyEvent = mockSendKeyEvent;
      resetState = vi.fn();
    },
  };
});

import { VncConnectionManager } from '../vnc/client.js';

function getLatestClient(): any {
  return mockConnect.mock.instances[mockConnect.mock.instances.length - 1];
}

describe('VncConnectionManager', () => {
  let manager: VncConnectionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new VncConnectionManager({
      host: 'localhost',
      port: 5900,
      password: 'test',
    });
  });

  describe('createConnection', () => {
    it('should resolve when firstFrameUpdate fires', async () => {
      const connectPromise = (manager as any).createConnection();
      const client = getLatestClient();

      client.emit('connected');
      client.emit('authenticated');

      expect(mockRequestFrameUpdate).toHaveBeenCalledWith(
        false, 0, 0, 1024, 768
      );

      client.emit('firstFrameUpdate');

      const result = await connectPromise;
      expect(result).toBeDefined();
    });

    it('should reject on connection timeout after 15s', async () => {
      vi.useFakeTimers();
      const connectPromise = (manager as any).createConnection();
      const client = getLatestClient();
      client.emit('connected');

      vi.advanceTimersByTime(15000);

      await expect(connectPromise).rejects.toThrow('VNC connection timeout');
      vi.useRealTimers();
    });

    it('should reject on VNC connectError event', async () => {
      const connectPromise = (manager as any).createConnection();
      const client = getLatestClient();

      client.emit('connectError', new Error('Connection refused'));

      await expect(connectPromise).rejects.toThrow('VNC connection error');
    });

    it('should clear timeout when firstFrameUpdate fires', async () => {
      vi.useFakeTimers();
      const connectPromise = (manager as any).createConnection();
      const client = getLatestClient();

      client.emit('connected');
      client.emit('authenticated');
      client.emit('firstFrameUpdate');

      await connectPromise;

      // Advance past timeout — should not trigger (timer was cleared)
      vi.advanceTimersByTime(20000);
      // Test passes if no timeout rejection occurs
      vi.useRealTimers();
    });

    it('should pass password in connection options', async () => {
      const connectPromise = (manager as any).createConnection();
      const client = getLatestClient();

      client.emit('connected');
      client.emit('authenticated');
      client.emit('firstFrameUpdate');

      await connectPromise;

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 5900,
          auth: { password: 'test' },
        })
      );
    });

    it('should not pass auth when no password configured', async () => {
      const noPassManager = new VncConnectionManager({
        host: 'localhost',
        port: 5900,
      });

      const connectPromise = (noPassManager as any).createConnection();
      const client = getLatestClient();

      client.emit('connected');
      client.emit('authenticated');
      client.emit('firstFrameUpdate');

      await connectPromise;

      expect(mockConnect).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined })
      );
    });
  });

  describe('validateCoordinates', () => {
    function makeClient(w: number, h: number): any {
      return { clientWidth: w, clientHeight: h };
    }

    it('should return valid for normal coordinates', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 512, 384);
      expect(r.valid).toBe(true);
    });

    it('should return valid for edge (0,0)', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 0, 0);
      expect(r.valid).toBe(true);
    });

    it('should return valid for edge (max-1, max-1)', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 1023, 767);
      expect(r.valid).toBe(true);
    });

    it('should return invalid for negative x', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, -1, 100);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('outside screen bounds');
    });

    it('should return invalid for x >= width', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 1024, 100);
      expect(r.valid).toBe(false);
    });

    it('should return invalid for negative y', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 100, -5);
      expect(r.valid).toBe(false);
    });

    it('should return invalid for y >= height', () => {
      const r = manager.validateCoordinates(makeClient(1024, 768) as any, 100, 768);
      expect(r.valid).toBe(false);
    });

    it('should return invalid when screen dimensions are unknown', () => {
      const r = manager.validateCoordinates(makeClient(0, 0) as any, 100, 100);
      expect(r.valid).toBe(false);
      expect(r.error).toContain('not yet available');
    });
  });

  describe('executeWithConnection', () => {
    it('should execute callback with connected client', async () => {
      const mockClient = new (class extends EventEmitter {
        clientWidth = 1024;
        clientHeight = 768;
        get connected() { return true; }
        get authenticated() { return true; }
      })();
      vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);

      const callback = vi.fn().mockResolvedValue({ content: ['done'] });
      const result = await manager.executeWithConnection(callback);

      expect(callback).toHaveBeenCalledWith(mockClient);
      expect(result).toEqual({ content: ['done'] });
    });

    it('should propagate callback errors', async () => {
      const mockClient = new (class extends EventEmitter {
        clientWidth = 1024;
        clientHeight = 768;
        get connected() { return true; }
        get authenticated() { return true; }
      })();
      vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);

      const callback = vi.fn().mockRejectedValue(new Error('Tool error'));

      await expect(
        manager.executeWithConnection(callback)
      ).rejects.toThrow('Tool error');
    });
  });

  describe('getState', () => {
    it('should return disconnected state when no client', () => {
      const state = manager.getState();
      expect(state.isConnected).toBe(false);
      expect(state.screenWidth).toBe(0);
      expect(state.screenHeight).toBe(0);
    });

    it('should return connected state with screen dimensions', async () => {
      const mockClient = new (class extends EventEmitter {
        clientWidth = 1920;
        clientHeight = 1080;
        clientName = 'TestVNC';
        pixelFormat = { bitsPerPixel: 32, depth: 24 };
        get connected() { return true; }
        get authenticated() { return true; }
      })();
      vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);

      await manager.executeWithConnection(vi.fn().mockResolvedValue(undefined));

      const state = manager.getState();
      expect(state.isConnected).toBe(true);
      expect(state.screenWidth).toBe(1920);
      expect(state.screenHeight).toBe(1080);
      expect(state.clientName).toBe('TestVNC');
      expect(state.bitsPerPixel).toBe(32);
      expect(state.depth).toBe(24);
    });
  });
});
