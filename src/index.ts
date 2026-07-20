#!/usr/bin/env node
// src/index.ts
import { VncMcpServer } from './server.js';
import { VncConfig } from './types.js';

let suppressedCount = 0;
const SUPPRESS_INTERVAL = 100;

process.on('uncaughtException', (error) => {
  if (
    error.message?.includes('invalid distance too far back') ||
    (error as any).code === 'Z_DATA_ERROR'
  ) {
    suppressedCount++;
    if (suppressedCount % SUPPRESS_INTERVAL === 1) {
      console.error(
        `VNC compression error (suppressed ${suppressedCount} occurrences):`,
        error.message
      );
    }
    return;
  }

  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

const config: VncConfig = {
  host: process.env.VNC_HOST || 'localhost',
  port: parseInt(process.env.VNC_PORT || '5900'),
  password: process.env.VNC_PASSWORD,
};

const server = new VncMcpServer(config);
server.run().catch(console.error);

process.on('SIGINT', () => {
  server.shutdown();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.shutdown();
  process.exit(0);
});
