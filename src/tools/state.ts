// src/tools/state.ts
import { VncConnectionManager } from '../vnc/client.js';

export async function handleGetState(vncManager: VncConnectionManager) {
  const state = vncManager.getState();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(state, null, 2),
      },
    ],
  };
}
