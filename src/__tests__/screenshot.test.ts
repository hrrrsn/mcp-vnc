import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockRequestFrameUpdate = vi.fn();
const mockSendPointerEvent = vi.fn();
const mockSendKeyEvent = vi.fn();

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
    resetState = vi.fn();
  },
}));

import { VncConnectionManager } from '../vnc/client.js';

function createMockManager(): VncConnectionManager {
  const manager = new VncConnectionManager({ host: 'localhost', port: 5900 });
  const mockClient = new (class extends EventEmitter {
    fb = Buffer.alloc(1024 * 768 * 4);
    clientWidth = 1024;
    clientHeight = 768;
    pixelFormat = {
      bitsPerPixel: 32, depth: 24, bigEndianFlag: 0, trueColorFlag: 1,
      redMax: 255, greenMax: 255, blueMax: 255,
      redShift: 0, greenShift: 8, blueShift: 16,
    };
    requestFrameUpdate = vi.fn();
  })();
  vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);
  vi.spyOn(manager as any, 'disconnect').mockImplementation(() => {});
  return manager;
}

describe('screenshot handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleScreenshot', () => {
    it('should throw when delay exceeds 300000ms', async () => {
      const { handleScreenshot } = await import('../tools/screenshot.js');
      const manager = createMockManager();

      await expect(
        handleScreenshot(manager, { delay: 300001 })
      ).rejects.toThrow('Delay cannot exceed');
    });

    it('should throw when screen dimensions are invalid', async () => {
      const { handleScreenshot } = await import('../tools/screenshot.js');
      const manager = createMockManager();
      const mockClient = new (class extends EventEmitter {
        clientWidth = 0;
        clientHeight = 0;
        pixelFormat = {};
        requestFrameUpdate = vi.fn();
      })();
      vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);

      await expect(handleScreenshot(manager, {})).rejects.toThrow(
        'Invalid screen dimensions'
      );
    });
  });

  describe('captureScreenshotWithDimensions', () => {
    it('should reject framebuffer with wrong bytes per pixel', async () => {
      const { captureScreenshotWithDimensions } = await import(
        '../tools/screenshot.js'
      );

      const badFb = Buffer.alloc(100);
      await expect(
        captureScreenshotWithDimensions(10, 10, badFb, 0)
      ).rejects.toThrow('Invalid bytes per pixel');
    });

    it('should reject framebuffer with wrong size for 2x2 RGBA', async () => {
      const { captureScreenshotWithDimensions } = await import(
        '../tools/screenshot.js'
      );

      // 2x2 * 4 bytes = 16 bytes expected, give 8
      const wrongFb = Buffer.alloc(8);
      await expect(
        captureScreenshotWithDimensions(2, 2, wrongFb, 0)
      ).rejects.toThrow('Invalid bytes per pixel');
    });

    it('should pass correct-sized RGBA framebuffer to sharp', async () => {
      const { captureScreenshotWithDimensions } = await import(
        '../tools/screenshot.js'
      );

      // 4x4 RGBA = 64 bytes - correct size, but sharp will fail on raw data
      const rgbaFb = Buffer.alloc(4 * 4 * 4);
      for (let i = 0; i < rgbaFb.length; i += 4) {
        rgbaFb[i] = 128;     // R
        rgbaFb[i + 1] = 128; // G
        rgbaFb[i + 2] = 128; // B
        rgbaFb[i + 3] = 255; // A
      }

      // This will throw because sharp isn't mocked, but it shouldn't throw
      // about bytes-per-pixel — it should get past that check
      try {
        await captureScreenshotWithDimensions(4, 4, rgbaFb, 0);
        // If sharp processes it, great. If not, error should be about sharp,
        // not about bytes per pixel
      } catch (e: any) {
        expect(e.message).not.toContain('bytes per pixel');
      }
    });
  });
});
