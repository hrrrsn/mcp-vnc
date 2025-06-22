// src/types.ts
import { VncClient } from '@computernewb/nodejs-rfb';

export interface VncConfig {
  host: string;
  port: number;
  password?: string;
}

export interface CoordinateValidation {
  valid: boolean;
  error?: string;
}

export interface KeyInput {
  modifiers: string[];
  key: string;
}

export interface VncServerState {
  isConnected: boolean;
  vncClient: VncClient | null;
  frameBuffer: Buffer | null;
  screenWidth: number;
  screenHeight: number;
}
