# BRMS — Browser Runtime MCP Server

Expose live browser state (DOM, Network, Console, Styles, Layout) as structured MCP tools for AI agents like Cursor.

## Quick Start

### 1. Install and build

```bash
npm install
npm run build
```

### 2. Launch Chrome with remote debugging

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222
```

### 3. Use with Cursor

The `.cursor/mcp.json` is already configured. Restart Cursor, then use the tools in Agent mode:

- "Connect to my browser and show me the open tabs"
- "Get the DOM tree of the current page"
- "Show me all failed network requests"
- "Why is the submit button not clickable?"

## Available Tools

### Connection
| Tool | Description |
|------|-------------|
| `connect_browser` | Connect to Chrome via CDP |
| `list_pages` | List open browser tabs |
| `select_page` | Select a tab for inspection |

### Inspection
| Tool | Description |
|------|-------------|
| `get_network_calls` | Captured network requests with filters |
| `get_dom_tree` | DOM tree snapshot |
| `query_dom` | CSS selector query |
| `get_console_errors` | Console errors and warnings |

### Styles & Layout
| Tool | Description |
|------|-------------|
| `get_computed_styles` | Computed CSS for elements |
| `get_layout_info` | Bounding box and visibility |
| `get_visible_elements` | Interactive elements in viewport |
| `capture_screenshot` | Full page or element screenshot |

### AI Debugging
| Tool | Description |
|------|-------------|
| `debug_element` | Diagnose element issues (visibility, clickability, overlaps) |
| `diagnose_network` | Analyze failed/slow network requests |
| `correlate_issues` | Cross-reference network, console, and DOM issues |

## Architecture

```
Chrome (CDP :9222)
  ↕ Playwright connectOverCDP
BRMS Node.js Process
  ├── Browser Layer (connection, network, DOM, console)
  ├── Tools Layer (MCP tool handlers)
  └── StdioServerTransport → Cursor
```

## Development

```bash
npm run dev    # watch mode
npm run build  # one-time build
npm start      # run server
```
