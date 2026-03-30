# BRMS — Browser Runtime MCP Server

Expose live browser state (DOM, Network, Console, Styles, Layout) as structured MCP tools for AI agents like Cursor.

## Architecture

```
Chrome Extension ←→ Native Messaging ←→ brms-host (Node.js) ←→ Cursor (HTTP MCP)
```

- **Chrome Extension** (Manifest V3): Captures DOM, network, console, styles, screenshots natively
- **brms-host** (Node.js): MCP server on `http://localhost:3100/mcp` using Streamable HTTP transport
- **Native Messaging**: Chrome's built-in IPC between the extension and the host process

## Quick Start

### 1. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Copy the **extension ID** from the card (32-character string)

### 2. Install the native messaging host

**If `brms-host` is published on npm:**

```bash
npx brms-host install --extension-id=<your-extension-id>
```

**If running from source:**

```bash
cd host
npm install
npm run build
node build/bin/install.js install --extension-id=<your-extension-id>
```

### 3. Configure Cursor

Add to your project's `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "brms": {
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

### 4. Verify

Click the BRMS extension icon in Chrome — it should show **Connected**. Then ask Cursor: *"Connect to my browser and list the open tabs."*

## Available Tools (15)

### Connection
| Tool | Description |
|------|-------------|
| `connect_browser` | Connect to browser via the Chrome Extension |
| `list_pages` | List all open tabs |
| `select_page` | Select a tab by index |

### DOM Inspection
| Tool | Description |
|------|-------------|
| `get_dom_tree` | Full or scoped DOM tree snapshot |
| `query_dom` | CSS selector query with attributes |

### Network
| Tool | Description |
|------|-------------|
| `get_network_calls` | Captured network requests with filtering |

### Console
| Tool | Description |
|------|-------------|
| `get_console_errors` | Console errors and warnings |

### Styles & Layout
| Tool | Description |
|------|-------------|
| `get_computed_styles` | Computed CSS with ancestor chain and pseudo-elements |
| `get_layout_info` | Bounding box, visibility, overlap, clipping, scroll |
| `get_visible_elements` | Interactive elements in viewport with a11y info |

### Visual
| Tool | Description |
|------|-------------|
| `capture_screenshot` | Page or element screenshot with highlight option |

### Events
| Tool | Description |
|------|-------------|
| `get_event_listeners` | Event listeners via Chrome DevTools Protocol |

### AI Debugging
| Tool | Description |
|------|-------------|
| `debug_element` | 11-point diagnostic for clickability/visibility |
| `diagnose_network` | Timing, CORS, rate limiting, error body analysis |
| `correlate_issues` | Cross-reference network, console, and DOM issues |

## Project Structure

```
golliath/
├── shared/
│   └── protocol.ts            # Message types (host ↔ extension)
├── extension/
│   ├── manifest.json          # Chrome MV3 manifest
│   ├── background.js          # Service worker (native messaging, debugger, routing)
│   ├── content.js             # DOM operations (styles, layout, debug)
│   ├── popup.html/js/css      # Setup wizard + status UI
│   └── icons/
├── host/
│   ├── package.json           # Publishable as "brms-host"
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts           # HTTP server + Streamable HTTP transport
│       ├── server.ts          # McpServer + 15 tool registrations
│       ├── bin/install.ts     # npx brms-host install
│       ├── bridge/            # Native messaging protocol
│       ├── browser/           # Proxy layer (via bridge)
│       ├── tools/             # MCP tool handlers
│       ├── types/             # TypeScript interfaces
│       └── utils/             # Logger, error helpers
├── package.json               # Root workspace
└── README.md
```

## Development

```bash
# Install all dependencies
npm install

# Build the host
npm run build

# Watch mode
npm run dev
```

After making changes to the host, reload the BRMS extension in Chrome to pick up the new build.

## How It Works

1. When the Chrome extension starts, it connects to the native messaging host
2. The host starts an HTTP server on port 3100
3. Cursor connects to `http://localhost:3100/mcp` via Streamable HTTP MCP transport
4. Tool calls flow: **Cursor → Host → Extension → Browser → Extension → Host → Cursor**
5. Network and console data are pushed from the extension in real time

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Popup shows "Disconnected" | Reload the extension on `chrome://extensions` |
| "Native host has exited" error | Run the install command again with the correct extension ID |
| Port 3100 already in use | Kill stale host: `lsof -ti :3100 \| xargs kill` then reload extension |
| Tools return "Extension not connected" | Call `connect_browser` first |

## License

MIT
