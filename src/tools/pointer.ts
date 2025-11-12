// src/tools/pointer.ts
import { VncConnectionManager } from '../vnc/client.js';

export async function handleGetMousePosition(vncManager: VncConnectionManager) {
  const pos = vncManager.getLastPointer();
  if (!pos) {
    return {
      content: [{ type: 'text', text: 'Mouse position is unknown (no prior move/click in this session).' }]
    };
  }
  return {
    content: [{ type: 'text', text: `Mouse position: (${pos.x}, ${pos.y})` }]
  };
}

