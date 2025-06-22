// src/vnc/client.ts
import { VncClient } from '@computernewb/nodejs-rfb';
import { VncConfig, CoordinateValidation } from '../types.js';

export class VncConnectionManager {
  private config: VncConfig;

  constructor(config: VncConfig) {
    this.config = config;
  }

  // Execute a callback with a fresh VNC connection that waits for full framebuffer
  async executeWithConnection<T>(callback: (client: VncClient) => Promise<T>): Promise<T> {
    const client = await this.createConnection();
    try {
      const result = await callback(client);
      return result;
    } finally {
      this.disconnect(client);
    }
  }

  private async createConnection(): Promise<VncClient> {
    return new Promise((resolve, reject) => {
      const vncClient = new VncClient({
        debug: false,
        encodings: [
          VncClient.consts.encodings.raw, // Try raw encoding first for problematic servers
          VncClient.consts.encodings.copyRect,
          VncClient.consts.encodings.hextile
          // Removed zrle as it seems to cause "Invalid subencoding" errors on some servers
        ]
      });

      let hasReceivedInitialFramebuffer = false;

      vncClient.on('connected', () => {
        console.error(`Connected to VNC server at ${this.config.host}:${this.config.port}`);
      });

      vncClient.on('authenticated', () => {
        const screenWidth = vncClient.clientWidth || 0;
        const screenHeight = vncClient.clientHeight || 0;
        console.error(`VNC authenticated, screen: ${screenWidth}x${screenHeight}`);
        
        // Request the initial full framebuffer
        vncClient.requestFrameUpdate(false, 0, 0, screenWidth, screenHeight);
      });

      vncClient.on('frameUpdated', () => {
        if (!hasReceivedInitialFramebuffer) {
          hasReceivedInitialFramebuffer = true;
          console.error('Received initial framebuffer, connection ready');
          resolve(vncClient);
        }
      });

      vncClient.on('error', (error) => {
        console.error(`VNC connection error: ${error.message}`);
        reject(new Error(`VNC connection error: ${error.message}`));
      });

      // Handle VNC disconnections
      vncClient.on('disconnect', (reason) => {
        console.error(`VNC disconnected: ${reason}`);
      });

      const connectionOptions = {
        host: this.config.host,
        port: this.config.port,
        path: null,
        auth: this.config.password ? { password: this.config.password } : undefined
      };

      vncClient.connect(connectionOptions);

      setTimeout(() => {
        reject(new Error('VNC connection timeout'));
      }, 15000); // Increased timeout to wait for initial frame
    });
  }

  private disconnect(client: VncClient): void {
    try {
      client.disconnect();
    } catch (error) {
      console.error('Error disconnecting VNC client:', error);
    }
  }

  public validateCoordinates(client: VncClient, x: number, y: number): CoordinateValidation {
    const screenWidth = client.clientWidth || 0;
    const screenHeight = client.clientHeight || 0;
    
    if (screenWidth === 0 || screenHeight === 0) {
      return { valid: true }; // Allow if dimensions not yet known
    }
    
    if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
      return {
        valid: false,
        error: `Coordinates (${x}, ${y}) are outside screen bounds (0, 0) to (${screenWidth - 1}, ${screenHeight - 1})`
      };
    }
    
    return { valid: true };
  }
}
