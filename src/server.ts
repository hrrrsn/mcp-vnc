// src/server.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VncConnectionManager } from './vnc/client.js';
import { VncConfig } from './types.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));
import { 
  handleClick, 
  handleMoveMouse, 
  handleKeyPress, 
  handleTypeText, 
  handleTypeMultiline, 
  handleScreenshot 
} from './tools/index.js';

export class VncMcpServer {
  private server: Server;
  private vncManager: VncConnectionManager;

  constructor(config: VncConfig) {
    this.vncManager = new VncConnectionManager(config);
    
    this.server = new Server(
      {
        name: 'vnc-control-server',
        version: packageJson.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'vnc_click',
            description: 'Click at specified coordinates',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
                button: { type: 'string', description: 'Mouse button', enum: ['left', 'right', 'middle'], default: 'left' },
                double: { type: 'boolean', description: 'Double-click instead of single click', default: false }
              },
              required: ['x', 'y']
            }
          },
          {
            name: 'vnc_move_mouse',
            description: 'Move mouse to specified coordinates',
            inputSchema: {
              type: 'object',
              properties: {
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' }
              },
              required: ['x', 'y']
            }
          },
          {
            name: 'vnc_key_press',
            description: 'Press a key or key combination',
            inputSchema: {
              type: 'object',
              properties: {
                key: { 
                  type: 'string', 
                  description: 'Key to press. Single keys: "a", "Enter", "F1". Combinations: "Ctrl+c", "Alt+F4", "Ctrl+Alt+Delete", "Shift+Tab"'
                }
              },
              required: ['key']
            }
          },
          {
            name: 'vnc_type_text',
            description: 'Type text string',
            inputSchema: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Single line of text to type' },
                enter: { type: 'boolean', description: 'Press Enter after typing text', default: false }
              },
              required: ['text']
            }
          },
          {
            name: 'vnc_type_multiline',
            description: 'Type multiple lines of text, separated by newlines',
            inputSchema: {
              type: 'object',
              properties: {
                lines: { type: 'array', items: { type: 'string' }, description: 'Array of lines to type' }
              },
              required: ['lines']
            }
          },
          {
            name: 'vnc_screenshot',
            description: 'Take a screenshot of the current screen',
            inputSchema: {
              type: 'object',
              properties: {
                delay: { 
                  type: 'number', 
                  description: 'Delay in milliseconds before taking screenshot (useful for waiting for processes to complete)',
                  minimum: 0,
                  maximum: 300000,
                  default: 0
                }
              }
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'vnc_click':
            return await handleClick(this.vncManager, args as any);
          case 'vnc_move_mouse':
            return await handleMoveMouse(this.vncManager, args as any);
          case 'vnc_key_press':
            return await handleKeyPress(this.vncManager, args as any);
          case 'vnc_type_text':
            return await handleTypeText(this.vncManager, args as any);
          case 'vnc_type_multiline':
            return await handleTypeMultiline(this.vncManager, args as any);
          case 'vnc_screenshot':
            return await handleScreenshot(this.vncManager, args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`
            }
          ]
        } as any;
      }
    });
  }

  async run() {
    try {
      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error(`mcp-vnc ${packageJson.version} started!`);
    } catch (error) {
      console.error('Failed to start mcp-vnc: ', error);
      process.exit(1);
    }
  }
}
