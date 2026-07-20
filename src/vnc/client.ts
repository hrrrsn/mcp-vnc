// src/vnc/client.ts
import { VncClient } from '@computernewb/nodejs-rfb';
import { VncConfig, CoordinateValidation, VncServerState } from '../types.js';

const CONNECTION_TIMEOUT = 15000;
const DEFAULT_OPERATION_TIMEOUT = 30000;

export class VncConnectionManager {
  private config: VncConfig;
  private client: VncClient | null = null;
  private connecting: Promise<VncClient> | null = null;
  private mutex: Promise<void> = Promise.resolve();
  private colorMap: { r: number; g: number; b: number }[] = [];

  constructor(config: VncConfig) {
    this.config = config;
  }

  /** Execute a callback with a managed VNC connection. Serializes calls via mutex. */
  async executeWithConnection<T>(callback: (client: VncClient) => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>(resolve => { release = resolve; });
    await prev;
    try {
      const client = await this.ensureConnected();
      return await Promise.race([
        callback(client),
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timeout')), this.config.operationTimeout || DEFAULT_OPERATION_TIMEOUT)
        ),
      ]);
    } finally {
      release();
    }
  }

  private async ensureConnected(): Promise<VncClient> {
    if (this.client?.connected && this.client.authenticated) {
      return this.client;
    }
    if (this.connecting) {
      return this.connecting;
    }
    this.connecting = this.createConnection();
    try {
      this.client = await this.connecting;
      return this.client;
    } finally {
      this.connecting = null;
    }
  }

  private createConnection(): Promise<VncClient> {
    return new Promise<VncClient>((resolve, reject) => {
      const vncClient = new VncClient({
        debug: false,
        encodings: [
          VncClient.consts.encodings.raw,
          VncClient.consts.encodings.copyRect,
          VncClient.consts.encodings.hextile,
        ],
      });

      let timerId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timerId !== null) {
          clearTimeout(timerId);
          timerId = null;
        }
      };

      vncClient.once('connected', () => {
        console.error(`Connected to VNC server at ${this.config.host}:${this.config.port}`);
      });

      vncClient.once('authenticated', () => {
        const w = vncClient.clientWidth || 0;
        const h = vncClient.clientHeight || 0;
        console.error(`VNC authenticated, screen: ${w}x${h}`);
        vncClient.requestFrameUpdate(false, 0, 0, w, h);
      });

      vncClient.once('firstFrameUpdate', () => {
        cleanup();
        console.error('Received initial framebuffer, connection ready');
        resolve(vncClient);
      });

      vncClient.once('connectError', (error: Error) => {
        cleanup();
        vncClient.removeAllListeners();
        console.error(`VNC connection error: ${error.message}`);
        reject(new Error(`VNC connection error: ${error.message}`));
      });

      vncClient.on('closed', () => {
        this.client = null;
        this.connecting = null;
        console.error('VNC connection closed');
      });

      vncClient.on('colorMapUpdated', (map: { r: number; g: number; b: number }[]) => {
        this.colorMap = map;
        console.error(`Color map updated: ${map.length} colors`);
      });

      const connectionOptions = {
        host: this.config.host,
        port: this.config.port,
        path: null,
        auth: this.config.password ? { password: this.config.password } : undefined,
      };

      vncClient.connect(connectionOptions);

      timerId = setTimeout(() => {
        timerId = null;
        reject(new Error('VNC connection timeout'));
      }, CONNECTION_TIMEOUT);
    });
  }

  /** Disconnect from VNC server and clean up state. Safe to call when not connected. */
  disconnect(): void {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch (error) {
        console.error('Error disconnecting VNC client:', error);
      }
      this.client = null;
    }
    this.connecting = null;
  }

  /** Validate coordinates against current screen dimensions. */
  validateCoordinates(client: VncClient, x: number, y: number): CoordinateValidation {
    const screenWidth = client.clientWidth || 0;
    const screenHeight = client.clientHeight || 0;

    if (screenWidth === 0 || screenHeight === 0) {
      return {
        valid: false,
        error: 'Screen dimensions not yet available',
      };
    }

    if (x < 0 || x >= screenWidth || y < 0 || y >= screenHeight) {
      return {
        valid: false,
        error: `Coordinates (${x}, ${y}) are outside screen bounds (0, 0) to (${screenWidth - 1}, ${screenHeight - 1})`,
      };
    }

    return { valid: true };
  }

  /** Get current VNC connection state without establishing a connection. */
  getState(): VncServerState {
    if (this.client) {
      return {
        isConnected: true,
        screenWidth: this.client.clientWidth || 0,
        screenHeight: this.client.clientHeight || 0,
        clientName: this.client.clientName || '',
        bitsPerPixel: this.client.pixelFormat?.bitsPerPixel || 0,
        depth: this.client.pixelFormat?.depth || 0,
      };
    }
    return {
      isConnected: false,
      screenWidth: 0,
      screenHeight: 0,
      clientName: '',
      bitsPerPixel: 0,
      depth: 0,
    };
  }

  /** Get the VNC color map for palette-based pixel format conversion. */
  getColorMap(): { r: number; g: number; b: number }[] {
    return this.colorMap;
  }
}
