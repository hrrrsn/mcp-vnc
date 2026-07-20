import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockVncManager = {
  disconnect: vi.fn(),
  executeWithConnection: vi.fn(),
  validateCoordinates: vi.fn().mockReturnValue({ valid: true }),
  getState: vi.fn().mockReturnValue({ isConnected: false, screenWidth: 0, screenHeight: 0 }),
  getColorMap: vi.fn().mockReturnValue([]),
};

vi.mock('../vnc/client.js', () => ({
  VncConnectionManager: vi.fn(function(this: any) {
    return mockVncManager;
  }),
}));

const mockServerSetHandler = vi.fn();
const mockServerConnect = vi.fn().mockResolvedValue(undefined);
const mockServerClose = vi.fn().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: vi.fn(function(this: any) {
    this.setRequestHandler = mockServerSetHandler;
    this.connect = mockServerConnect;
    this.close = mockServerClose;
    return this;
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: Symbol('CallToolRequestSchema'),
  ListToolsRequestSchema: Symbol('ListToolsRequestSchema'),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(JSON.stringify({ version: '1.0.0' })),
}));

import { VncMcpServer } from '../server.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

describe('VncMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('setupTools — tool registration', () => {
    it('should register ListToolsRequestSchema and CallToolRequestSchema handlers', () => {
      new VncMcpServer({ host: 'localhost', port: 5900 });

      expect(mockServerSetHandler).toHaveBeenCalledTimes(2);
      expect(mockServerSetHandler).toHaveBeenCalledWith(ListToolsRequestSchema, expect.any(Function));
      expect(mockServerSetHandler).toHaveBeenCalledWith(CallToolRequestSchema, expect.any(Function));
    });

    it('should list exactly 9 tools', async () => {
      new VncMcpServer({ host: 'localhost', port: 5900 });

      const listHandler = mockServerSetHandler.mock.calls.find(
        (call: any) => call[0] === ListToolsRequestSchema
      )[1];

      const result = await listHandler();
      expect(result.tools).toHaveLength(9);

      const toolNames = result.tools.map((t: any) => t.name).sort();
      expect(toolNames).toEqual([
        'vnc_click',
        'vnc_clipboard_set',
        'vnc_drag',
        'vnc_get_state',
        'vnc_key_press',
        'vnc_move_mouse',
        'vnc_screenshot',
        'vnc_type_multiline',
        'vnc_type_text',
      ].sort());
    });

    it('each tool should have name, description, and inputSchema', async () => {
      new VncMcpServer({ host: 'localhost', port: 5900 });

      const listHandler = mockServerSetHandler.mock.calls.find(
        (call: any) => call[0] === ListToolsRequestSchema
      )[1];

      const result = await listHandler();
      for (const tool of result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type', 'object');
      }
    });
  });

  describe('setupTools — tool dispatch', () => {
    function getCallHandler(): (request: any) => Promise<any> {
      new VncMcpServer({ host: 'localhost', port: 5900 });
      return mockServerSetHandler.mock.calls.find(
        (call: any) => call[0] === CallToolRequestSchema
      )[1];
    }

    it('should route vnc_click to handleClick', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'clicked left button at (100, 200)' }],
      });

      const result = await handler({
        params: { name: 'vnc_click', arguments: { x: 100, y: 200 } },
      });

      expect(mockVncManager.executeWithConnection).toHaveBeenCalled();
      expect(result.content[0].text).toContain('clicked left button');
    });

    it('should route vnc_move_mouse to handleMoveMouse', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Moved mouse to (100, 200)' }],
      });

      const result = await handler({
        params: { name: 'vnc_move_mouse', arguments: { x: 100, y: 200 } },
      });

      expect(result.content[0].text).toContain('Moved mouse');
    });

    it('should route vnc_key_press to handleKeyPress', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Pressed key combination: Enter' }],
      });

      const result = await handler({
        params: { name: 'vnc_key_press', arguments: { key: 'Enter' } },
      });

      expect(result.content[0].text).toContain('Pressed key');
    });

    it('should route vnc_type_text to handleTypeText', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Typed text: hello' }],
      });

      const result = await handler({
        params: { name: 'vnc_type_text', arguments: { text: 'hello' } },
      });

      expect(result.content[0].text).toContain('Typed text');
    });

    it('should route vnc_type_multiline to handleTypeMultiline', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Typed 2 lines: a | b' }],
      });

      const result = await handler({
        params: { name: 'vnc_type_multiline', arguments: { lines: ['a', 'b'] } },
      });

      expect(result.content[0].text).toContain('Typed 2 lines');
    });

    it('should route vnc_screenshot to handleScreenshot', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Screenshot captured' }, { type: 'image', data: '...', mimeType: 'image/jpeg' }],
      });

      const result = await handler({
        params: { name: 'vnc_screenshot', arguments: {} },
      });

      expect(result.content[0].text).toContain('Screenshot captured');
    });

    it('should route vnc_get_state to handleGetState', async () => {
      const handler = getCallHandler();
      mockVncManager.getState = vi.fn().mockReturnValue({
        isConnected: false, screenWidth: 0, screenHeight: 0, clientName: '', bitsPerPixel: 0, depth: 0,
      });

      const result = await handler({
        params: { name: 'vnc_get_state', arguments: {} },
      });

      expect(mockVncManager.getState).toHaveBeenCalled();
      expect(result.content[0].text).toBeDefined();
    });

    it('should route vnc_clipboard_set to handleClipboardSet', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Clipboard set: test' }],
      });

      const result = await handler({
        params: { name: 'vnc_clipboard_set', arguments: { text: 'test' } },
      });

      expect(result.content[0].text).toContain('Clipboard set');
    });

    it('should route vnc_drag to handleDrag', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Dragged from (0,0) to (100,100)' }],
      });

      const result = await handler({
        params: { name: 'vnc_drag', arguments: { fromX: 0, fromY: 0, toX: 100, toY: 100 } },
      });

      expect(result.content[0].text).toContain('Dragged from');
    });

    it('should return error for unknown tool name', async () => {
      const handler = getCallHandler();

      const result = await handler({
        params: { name: 'vnc_unknown', arguments: {} },
      });

      expect(result.content[0].text).toContain('Error: Unknown tool: vnc_unknown');
    });

    it('should catch and return handler errors gracefully', async () => {
      const handler = getCallHandler();
      mockVncManager.executeWithConnection = vi.fn().mockRejectedValue(new Error('Simulated failure'));

      const result = await handler({
        params: { name: 'vnc_click', arguments: { x: 100, y: 200 } },
      });

      expect(result.content[0].text).toContain('Error: Simulated failure');
    });
  });

  describe('shutdown', () => {
    it('should call vncManager.disconnect()', () => {
      const server = new VncMcpServer({ host: 'localhost', port: 5900 });
      mockVncManager.disconnect = vi.fn();
      server.shutdown();
      expect(mockVncManager.disconnect).toHaveBeenCalled();
    });

    it('should be idempotent (safe to call twice)', () => {
      const server = new VncMcpServer({ host: 'localhost', port: 5900 });
      mockVncManager.disconnect = vi.fn();
      server.shutdown();
      server.shutdown();
      expect(mockVncManager.disconnect).toHaveBeenCalledTimes(2);
    });
  });
});
