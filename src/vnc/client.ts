// src/vnc/client.ts
import { VncClient } from '@computernewb/nodejs-rfb';
import { VncConfig, CoordinateValidation } from '../types.js';

export class VncConnectionManager {
  private config: VncConfig;
  private client: VncClient | null = null;
  private connectingPromise: Promise<VncClient> | null = null;

  constructor(config: VncConfig) {
    this.config = config;
  }

  async executeWithConnection<T>(
    callback: (client: VncClient) => Promise<T>,
    options: { waitForFramebuffer?: boolean } = {}
  ): Promise<T> {
    const client = await this.getConnection(options);
    try {
      const result = await callback(client);
      return result;
    } catch (error) {
      // A protocol/write failure can leave the VNC client in a bad state.
      this.invalidateConnection(client);
      throw error;
    }
  }

  private async getConnection(options: { waitForFramebuffer?: boolean } = {}): Promise<VncClient> {
    if (this.isConnectionReady(this.client)) {
      if (options.waitForFramebuffer && !this.hasUsableFramebuffer(this.client)) {
        await this.waitForFramebuffer(this.client);
      }
      return this.client;
    }

    if (!this.connectingPromise) {
      this.connectingPromise = this.createConnection(options)
        .then((client) => {
          this.client = client;
          return client;
        })
        .finally(() => {
          this.connectingPromise = null;
        });
    }

    const client = await this.connectingPromise;
    if (options.waitForFramebuffer && !this.hasUsableFramebuffer(client)) {
      await this.waitForFramebuffer(client);
    }

    return client;
  }

  private isConnectionReady(client: VncClient | null): client is VncClient {
    return !!client && client.connected && client.authenticated;
  }

  private hasUsableFramebuffer(client: VncClient | null): boolean {
    if (!client) {
      return false;
    }

    const screenWidth = client.clientWidth || 0;
    const screenHeight = client.clientHeight || 0;
    return screenWidth > 0 &&
      screenHeight > 0 &&
      !!client.fb &&
      client.fb.length >= screenWidth * screenHeight * 4;
  }

  private async waitForFramebuffer(client: VncClient): Promise<void> {
    if (this.hasUsableFramebuffer(client)) {
      return;
    }

    const screenWidth = client.clientWidth || 0;
    const screenHeight = client.clientHeight || 0;

    try {
      client.requestFrameUpdate(false, 1, 0, 0, screenWidth, screenHeight);
    } catch (error) {
      console.warn('Frame request failed:', error);
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        client.removeListener('frameUpdated', finish);
        client.removeListener('firstFrameUpdate', finish);
        resolve();
      };

      client.once('frameUpdated', finish);
      client.once('firstFrameUpdate', finish);
      setTimeout(finish, 3000);
    });

    if (!this.hasUsableFramebuffer(client)) {
      throw new Error('VNC framebuffer timeout');
    }
  }

  private invalidateConnection(client: VncClient): void {
    if (this.client === client) {
      this.client = null;
    }

    this.disconnect(client);
  }

  private async createConnection(options: { waitForFramebuffer?: boolean } = {}): Promise<VncClient> {
    return new Promise((resolve, reject) => {
      const vncClient = new VncClient({
        debug: false,
        encodings: [
          // Raw is larger, but avoids intermittent decoder/offset failures from compressed encodings.
          VncClient.consts.encodings.raw,
          VncClient.consts.encodings.pseudoDesktopSize
        ]
      });

      let settled = false;
      let connectionTimeout: NodeJS.Timeout | null = null;
      const waitForFramebuffer = options.waitForFramebuffer || false;

      const cleanupAndResolve = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }
        resolve(vncClient);
      };

      const cleanupAndReject = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
        }
        reject(error);
      };

      vncClient.on('connected', () => {
        console.error(`Connected to VNC server at ${this.config.host}:${this.config.port}`);
      });

      vncClient.on('authenticated', () => {
        const screenWidth = vncClient.clientWidth || 0;
        const screenHeight = vncClient.clientHeight || 0;
        console.error(`VNC authenticated, screen: ${screenWidth}x${screenHeight}`);

        if (!waitForFramebuffer) {
          cleanupAndResolve();
          return;
        }

        try {
          vncClient.requestFrameUpdate(false, 1, 0, 0, screenWidth, screenHeight);
        } catch (error) {
          console.warn('Initial frame request failed:', error);
        }

        setTimeout(() => {
          if (!settled && this.hasUsableFramebuffer(vncClient)) {
            console.error('Using existing framebuffer, connection ready');
            cleanupAndResolve();
          }
        }, 2500);
      });

      vncClient.on('frameUpdated', () => {
        if (!settled && (!waitForFramebuffer || this.hasUsableFramebuffer(vncClient))) {
          console.error('Received initial framebuffer, connection ready');
          cleanupAndResolve();
        }
      });

      vncClient.on('firstFrameUpdate', () => {
        if (!settled && (!waitForFramebuffer || this.hasUsableFramebuffer(vncClient))) {
          console.error('Received first framebuffer, connection ready');
          cleanupAndResolve();
        }
      });

      vncClient.on('error', (error) => {
        console.error(`VNC connection error: ${error.message}`);
        cleanupAndReject(new Error(`VNC connection error: ${error.message}`));
      });

      // Handle VNC disconnections
      vncClient.on('disconnect', (reason) => {
        console.error(`VNC disconnected: ${reason}`);
        if (this.client === vncClient) {
          this.client = null;
        }
      });

      const connectionOptions = {
        host: this.config.host,
        port: this.config.port,
        path: null,
        auth: this.config.password ? { password: this.config.password } : undefined
      };

      vncClient.connect(connectionOptions);

      connectionTimeout = setTimeout(() => {
        cleanupAndReject(new Error('VNC connection timeout'));
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
