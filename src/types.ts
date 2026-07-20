// src/types.ts

export interface VncConfig {
  host: string;
  port: number;
  password?: string;
  operationTimeout?: number;
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
  screenWidth: number;
  screenHeight: number;
  clientName: string;
  bitsPerPixel: number;
  depth: number;
}
