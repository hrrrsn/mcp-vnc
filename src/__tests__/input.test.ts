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
import { handleClick, handleMoveMouse, handleKeyPress, handleTypeText, handleTypeMultiline } from '../tools/input.js';

function createMockClient() {
  const c = new (class extends EventEmitter {})() as any;
  c.clientWidth = 1024;
  c.clientHeight = 768;
  c.sendPointerEvent = mockSendPointerEvent;
  c.sendKeyEvent = mockSendKeyEvent;
  return c;
}

function createMockManager(): VncConnectionManager {
  const manager = new VncConnectionManager({
    host: 'localhost', port: 5900, password: 'test',
  });
  const mockClient = createMockClient();
  vi.spyOn(manager as any, 'createConnection').mockResolvedValue(mockClient);
  vi.spyOn(manager as any, 'disconnect').mockImplementation(() => {});
  return manager;
}

describe('input handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleClick', () => {
    it('should send left click at specified coordinates', async () => {
      const manager = createMockManager();
      const result = await handleClick(manager, { x: 100, y: 200 });
      expect(result.content[0].text).toContain('clicked left button at (100, 200)');
    });

    it('should send right click', async () => {
      const manager = createMockManager();
      const result = await handleClick(manager, { x: 100, y: 200, button: 'right' });
      expect(result.content[0].text).toContain('clicked right button');
    });

    it('should send middle click', async () => {
      const manager = createMockManager();
      const result = await handleClick(manager, { x: 100, y: 200, button: 'middle' });
      expect(result.content[0].text).toContain('clicked middle button');
    });

    it('should perform double-click', async () => {
      const manager = createMockManager();
      const result = await handleClick(manager, { x: 100, y: 200, double: true });
      expect(result.content[0].text).toContain('double-clicked');
    });

    it('should default button to left when unspecified', async () => {
      const manager = createMockManager();
      const result = await handleClick(manager, { x: 50, y: 50 });
      expect(result.content[0].text).toContain('left button');
    });

    it('should reject coordinates outside screen bounds', async () => {
      const manager = createMockManager();
      await expect(handleClick(manager, { x: 9999, y: 9999 })).rejects.toThrow('outside screen bounds');
    });
  });

  describe('handleMoveMouse', () => {
    it('should move mouse to specified coordinates', async () => {
      const manager = createMockManager();
      const result = await handleMoveMouse(manager, { x: 500, y: 300 });
      expect(result.content[0].text).toBe('Moved mouse to (500, 300)');
    });

    it('should reject out-of-bounds coordinates', async () => {
      const manager = createMockManager();
      await expect(handleMoveMouse(manager, { x: -1, y: 300 })).rejects.toThrow('outside screen bounds');
    });
  });

  describe('handleKeyPress', () => {
    it('should send single key press', async () => {
      const manager = createMockManager();
      const result = await handleKeyPress(manager, { key: 'Enter' });
      expect(result.content[0].text).toBe('Pressed key combination: Enter');
    });

    it('should send key combination with modifiers', async () => {
      const manager = createMockManager();
      const result = await handleKeyPress(manager, { key: 'Ctrl+Alt+Delete' });
      expect(result.content[0].text).toBe('Pressed key combination: Ctrl+Alt+Delete');
    });

    it('should send single modifier combination', async () => {
      const manager = createMockManager();
      const result = await handleKeyPress(manager, { key: 'Alt+F4' });
      expect(result.content[0].text).toBe('Pressed key combination: Alt+F4');
    });
  });

  describe('handleTypeText', () => {
    it('should type text without enter', async () => {
      const manager = createMockManager();
      const result = await handleTypeText(manager, { text: 'Hello' });
      expect(result.content[0].text).toBe('Typed text: Hello');
    });

    it('should append + Enter when enter=true', async () => {
      const manager = createMockManager();
      const result = await handleTypeText(manager, { text: 'Hello', enter: true });
      expect(result.content[0].text).toBe('Typed text: Hello + Enter');
    });

    it('should handle text with special characters', async () => {
      const manager = createMockManager();
      const result = await handleTypeText(manager, { text: 'Hello, World! Test: 123' });
      expect(result.content[0].text).toContain('Hello, World! Test: 123');
    });

    it('should handle empty text', async () => {
      const manager = createMockManager();
      const result = await handleTypeText(manager, { text: '' });
      expect(result.content[0].text).toBe('Typed text: ');
    });
  });

  describe('handleTypeMultiline', () => {
    it('should type multiple lines', async () => {
      const manager = createMockManager();
      const result = await handleTypeMultiline(manager, { lines: ['Line 1', 'Line 2', 'Line 3'] });
      expect(result.content[0].text).toContain('Typed 3 lines');
      expect(result.content[0].text).toContain('Line 1 | Line 2 | Line 3');
    });

    it('should handle single line', async () => {
      const manager = createMockManager();
      const result = await handleTypeMultiline(manager, { lines: ['Only one line'] });
      expect(result.content[0].text).toContain('Typed 1 lines');
    });

    it('should handle empty array', async () => {
      const manager = createMockManager();
      const result = await handleTypeMultiline(manager, { lines: [] });
      expect(result.content[0].text).toContain('Typed 0 lines');
    });
  });
});
