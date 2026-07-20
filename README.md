# mcp-vnc

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm version](https://badge.fury.io/js/@hrrrsn%2Fmcp-vnc.svg)](https://badge.fury.io/js/@hrrrsn%2Fmcp-vnc)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction) server that enables AI agents to remotely control Windows, Linux, macOS or anything else that can run a VNC server.

## Quick Start

### Install from NPM

```bash
npm install -g @hrrrsn/mcp-vnc
```

### Install from Source

```bash
git clone https://github.com/hrrrsn/mcp-vnc
cd mcp-vnc
npm install
npm run build
```

## Configuration

### Claude Desktop

1. Locate and open your Claude Desktop configuration file:
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. Add the following configuration:

**Using NPM Install:**
```json
{
  "mcpServers": {
    "vnc-controller": {
      "type": "stdio",
      "command": "mcp-vnc",
      "env": {
        "VNC_HOST": "192.168.1.100",
        "VNC_PORT": "5900",
        "VNC_PASSWORD": "your-vnc-password"
      }
    }
  }
}
```

**Built from Source:**
```json
{
  "mcpServers": {
    "vnc-controller": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"],
      "cwd": "/path/to/mcp-vnc",
      "env": {
        "VNC_HOST": "192.168.1.100",
        "VNC_PORT": "5900",
        "VNC_PASSWORD": "your-vnc-password"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VNC_HOST` | No | `localhost` | VNC server hostname or IP |
| `VNC_PORT` | No | `5900` | VNC server port |
| `VNC_PASSWORD` | No | (none) | VNC server password |

### VS Code

Please refer to the [VS Code documentation](https://code.visualstudio.com/docs/copilot/chat/mcp-servers)

## Available Tools

The MCP server provides **9 tools** for remote desktop control:

### Mouse Control

<details>
<summary><strong>vnc_click</strong> — Click at specified coordinates</summary>

| Parameter | Required | Type | Description | Default |
|-----------|----------|------|-------------|---------|
| `x` | Yes | number | X coordinate | — |
| `y` | Yes | number | Y coordinate | — |
| `button` | No | string | Mouse button (`left`, `right`, `middle`) | `left` |
| `double` | No | boolean | Double-click instead of single click | `false` |

**Examples:** 
- `vnc_click(x=100, y=200)` — left click
- `vnc_click(x=100, y=200, button="right")` — right click
- `vnc_click(x=100, y=200, double=true)` — double click
</details>

<details>
<summary><strong>vnc_move_mouse</strong> — Move mouse cursor</summary>

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `x` | Yes | number | X coordinate |
| `y` | Yes | number | Y coordinate |

**Example:** `vnc_move_mouse(x=500, y=300)`
</details>

<details>
<summary><strong>vnc_drag</strong> — Drag mouse from one position to another</summary>

| Parameter | Required | Type | Description | Default |
|-----------|----------|------|-------------|---------|
| `fromX` | Yes | number | Starting X coordinate | — |
| `fromY` | Yes | number | Starting Y coordinate | — |
| `toX` | Yes | number | Ending X coordinate | — |
| `toY` | Yes | number | Ending Y coordinate | — |
| `button` | No | string | Button to hold (`left`, `right`, `middle`) | `left` |

**Example:** `vnc_drag(fromX=0, fromY=0, toX=200, toY=100)` — drag from top-left
</details>

### Keyboard Control

<details>
<summary><strong>vnc_key_press</strong> — Send keys and key combinations</summary>

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `key` | Yes | string | Key or key combination to press |

**Supported Keys:**
- **Single keys**: `a`–`z`, `0`–`9`, `Enter`, `Escape`, `Tab`, `Space`, `BackSpace`, `Delete`
- **Arrow keys**: `Up`, `Down`, `Left`, `Right`
- **Navigation**: `Home`, `End`, `Page_Up`, `Page_Down`, `Insert`
- **Function keys**: `F1`–`F12`
- **Key combinations**: `Ctrl+c`, `Alt+F4`, `Ctrl+Alt+Delete`, `Shift+Tab`
- **Modifiers**: `Ctrl`, `Alt`, `Shift`, `Super`/`Win`, `Meta`/`Cmd`

**Examples:** 
- `vnc_key_press(key="Enter")`
- `vnc_key_press(key="Ctrl+Alt+Delete")`
- `vnc_key_press(key="Alt+F4")`
</details>

### Text Input

<details>
<summary><strong>vnc_type_text</strong> — Type single-line text</summary>

| Parameter | Required | Type | Description | Default |
|-----------|----------|------|-------------|---------|
| `text` | Yes | string | Text to type | — |
| `enter` | No | boolean | Press Enter after typing | `false` |

**Performance:** Uses adaptive typing speed — 30ms per character for plain text, 50ms per character for text with special characters (`!@#$%^&*()`, etc.).

**Example:** `vnc_type_text(text="Hello World!", enter=true)`
</details>

<details>
<summary><strong>vnc_type_multiline</strong> — Type multiple lines</summary>

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `lines` | Yes | string[] | Array of lines to type |

Each line is typed character-by-character with Enter pressed after each.

**Example:** `vnc_type_multiline(lines=["Line 1", "Line 2", "Line 3"])`
</details>

### Screen Capture

<details>
<summary><strong>vnc_screenshot</strong> — Capture screen</summary>

| Parameter | Required | Type | Description | Default |
|-----------|----------|------|-------------|---------|
| `delay` | No | number | Delay before screenshot (0–300000ms) | `0` |

Returns a base64-encoded JPEG image. Automatically resizes images larger than 800KB.

**Pixel format support:** RGBA (standard), RGB24, RGB565, 8-bit palette (with VNC color map), BGRX/non-standard RGBA, big-endian RGBA, high-byte color (redMax=65280). Corruption patterns (all-black, all-white, repeating byte sequences) are detected and logged as warnings.

**Example:** `vnc_screenshot(delay=1000)` — wait 1 second before capture
</details>

### State & Clipboard

<details>
<summary><strong>vnc_get_state</strong> — Get connection state</summary>

No parameters. Returns a JSON object with:

```json
{
  "isConnected": true,
  "screenWidth": 1920,
  "screenHeight": 1080,
  "clientName": "QEMU",
  "bitsPerPixel": 32,
  "depth": 24
}
```
</details>

<details>
<summary><strong>vnc_clipboard_set</strong> — Set remote clipboard</summary>

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `text` | Yes | string | Text to set as clipboard content |

**Example:** `vnc_clipboard_set(text="copied content")`
</details>

## Architecture

```
┌──────────────────────┐
│   MCP Client (AI)    │
│   ───── stdio ─────  │
└──────────┬───────────┘
           │ JSON-RPC
┌──────────▼───────────┐
│    server.ts         │  MCP server: tool registration, request routing
│    VncMcpServer      │  9 tools via CallToolRequestSchema
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│    vnc/client.ts     │  VncConnectionManager: persistent connection,
│                      │  mutex-serialized operations, auto-reconnect,
│                      │  coordinate validation, color map, timeouts
└──────────┬───────────┘
           │   event-driven (connected, authenticated, firstFrameUpdate)
┌──────────▼───────────┐
│  @computernewb/      │  VNC protocol (RFB) client
│  nodejs-rfb          │  framebuffer, pixel format, input events
└──────────────────────┘
```

### Key Design Decisions

| Decision | Rationale | Document |
|----------|-----------|----------|
| **Persistent connection** | One VNC session shared across all tool calls. AI doesn't wait for reconnect between operations. | `architecture/ADR-001-persistent-vnc-connection.md` |
| **Promise-chain mutex** | Serializes concurrent tool calls to prevent RFB protocol corruption. 30s operation timeout per call. | `ADR-001` |
| **Auto-reconnect** | If VNC disconnects mid-session, next tool call transparently reconnects. | `ADR-001` |
| **Configurable timeouts** | `operationTimeout` in `VncConfig` — defaults to 30s, adjustable per environment. | `ADR-001` |

### Source Layout

```
src/
├── index.ts              Entry point, env config, global error handlers
├── server.ts             VncMcpServer — MCP protocol layer
├── types.ts              VncConfig, VncServerState, CoordinateValidation
├── vnc/
│   ├── client.ts         VncConnectionManager — VNC lifecycle
│   └── keyboard.ts       Keysym maps, parseKeyInput, charNeedsShift
├── tools/
│   ├── index.ts          Barrel re-exports
│   ├── input.ts          handleClick, handleMoveMouse, handleKeyPress,
│   │                     handleTypeText, handleTypeMultiline,
│   │                     handleClipboardSet, handleDrag
│   ├── screenshot.ts     handleScreenshot, pixel format conversion,
│   │                     corruption detection, JPEG encoding
│   └── state.ts          handleGetState
└── __tests__/            163 tests across 9 files
```

### Pixel Format Pipeline

```
VNC Framebuffer (raw)
    │
    ├─ bytesPerPixel === 4, standard RGBA ──► captureScreenshotWithDimensions()
    │     (redShift=0, greenShift=8, blueShift=16, all max=255)
    │
    ├─ bytesPerPixel === 4, non-standard ──► convertNonStandardRGBA()
    │     (BGRX, big-endian, redMax=65280, etc.)
    │
    ├─ bytesPerPixel === 3 ──► convertToRGBA() RGB24→RGBA
    ├─ bytesPerPixel === 2 ──► convertToRGBA() RGB565→RGBA
    ├─ bytesPerPixel === 1 ──► convertToRGBA() 8-bit palette→RGBA
    │     (uses colorMapUpdated event + getColorMap())
    │
    └─ hasCorruptionPatterns() ──► warning if >90% black/white or repeating 16-byte pattern

    │
    ▼
sharp(raw RGBA) → JPEG (80% quality) → base64 → MCP response
    │
    └─ if >800KB → resize down to fit
```

## Testing

```bash
npm test              # Run all 163 unit tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

| File | Tests | Focus |
|------|-------|-------|
| `vnc-client.test.ts` | 18 | Connection lifecycle, mutex, coordinate validation, state |
| `keyboard.test.ts` | 19 | Keysym maps, parseKeyInput, charNeedsShift |
| `input.test.ts` | 18 | Mouse click/move, key press, text typing |
| `screenshot.test.ts` | 5 | Delay validation, dimension checks, RGBA→JPEG |
| `fixes-expected.test.ts` | 24 | Timer cleanup, event ordering, persistent connection, mutex, errors |
| `review-scenarios.test.ts` | 15 | Mutex deadlock, shutdown, pixel formats, typing heuristics, big-endian |
| `tools-advanced.test.ts` | 19 | handleGetState, handleClipboardSet, handleDrag, mock call verification |
| `screenshot-internal.test.ts` | 29 | RGB24/RGB565/8-bit conversion, needsPixelFormatConversion, convertNonStandardRGBA, hasCorruptionPatterns |
| `server.test.ts` | 16 | Tool registration (9 tools), dispatch routing, error handling, shutdown |
| **Total** | **163** | |

## Tech Debt

Tracked in `TECH_DEBT.md`. Current status: **9/10 resolved**. One remaining item: refactor `screenshot.ts` (311 lines, 4 concerns) into `pixel-format.ts` + `screenshot-capture.ts`.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
