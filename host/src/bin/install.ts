#!/usr/bin/env node

/**
 * brms-host install
 *
 * Registers the native messaging host manifest so Chrome can find it.
 * Also prints the Cursor MCP config.
 *
 * Usage:
 *   npx brms-host install
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.brms.host';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getManifestDir(): string {
  const os = platform();

  if (os === 'darwin') {
    return resolve(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts');
  }
  if (os === 'linux') {
    return resolve(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts');
  }
  if (os === 'win32') {
    return resolve(homedir(), 'AppData', 'Roaming', 'brms');
  }

  throw new Error(`Unsupported OS: ${os}`);
}

function getHostEntrypoint(): string {
  return resolve(__dirname, '..', 'index.js');
}

function install(): void {
  const manifestDir = getManifestDir();
  const hostPath = getHostEntrypoint();

  if (!existsSync(manifestDir)) {
    mkdirSync(manifestDir, { recursive: true });
  }

  const manifest = {
    name: HOST_NAME,
    description: 'BRMS Native Messaging Host — bridges Chrome Extension to MCP server',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${process.env.BRMS_EXTENSION_ID || '*'}/`,
    ],
  };

  // On macOS/Linux, Chrome expects a wrapper script, not node directly
  const os = platform();
  if (os === 'darwin' || os === 'linux') {
    const wrapperPath = resolve(manifestDir, 'brms-host');
    const nodeExec = process.execPath;
    writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodeExec}" "${hostPath}" "$@"\n`, { mode: 0o755 });
    manifest.path = wrapperPath;
  }

  const manifestPath = resolve(manifestDir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // On Windows, also set registry key
  if (os === 'win32') {
    console.log('\n[brms] Windows detected. You may need to add a registry key:');
    console.log(`  HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`);
    console.log(`  Value: ${manifestPath}\n`);
  }

  console.log('');
  console.log('  BRMS Native Messaging Host installed successfully!');
  console.log('');
  console.log(`  Manifest: ${manifestPath}`);
  console.log(`  Host:     ${manifest.path}`);
  console.log('');
  console.log('  Next steps:');
  console.log('');
  console.log('  1. Load the BRMS extension in Chrome:');
  console.log('     chrome://extensions → Enable Developer mode → Load unpacked');
  console.log('');
  console.log('  2. Add to your project\'s .cursor/mcp.json:');
  console.log('');
  console.log('     {');
  console.log('       "mcpServers": {');
  console.log('         "brms": {');
  console.log('           "url": "http://localhost:3100/mcp"');
  console.log('         }');
  console.log('       }');
  console.log('     }');
  console.log('');
}

const cmd = process.argv[2];

if (cmd === 'install') {
  install();
} else {
  console.log('Usage: brms-host install');
  console.log('');
  console.log('Commands:');
  console.log('  install    Register the native messaging host for Chrome');
  process.exit(1);
}
