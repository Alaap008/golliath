#!/usr/bin/env node

/**
 * brms-host install [--extension-id=<id>]
 *
 * Registers the native messaging host manifest so Chrome can find it.
 * Also prints the Cursor MCP config.
 *
 * The extension ID is required. You can find it on chrome://extensions
 * after loading the unpacked extension. Pass it via:
 *   --extension-id=<id>     CLI flag
 *   BRMS_EXTENSION_ID=<id>  environment variable
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOST_NAME = 'com.brms.host';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseExtensionId(): string | null {
  for (const arg of process.argv) {
    if (arg.startsWith('--extension-id=')) {
      return arg.split('=')[1];
    }
  }
  return process.env.BRMS_EXTENSION_ID || null;
}

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
  const extensionId = parseExtensionId();

  if (!extensionId) {
    console.error('');
    console.error('  Error: Extension ID is required.');
    console.error('');
    console.error('  1. Load the BRMS extension in Chrome:');
    console.error('     chrome://extensions → Enable Developer mode → Load unpacked');
    console.error('');
    console.error('  2. Copy the extension ID from the extension card, then run:');
    console.error('');
    console.error('     npx brms-host install --extension-id=<your-extension-id>');
    console.error('');
    process.exit(1);
  }

  if (!/^[a-z]{32}$/.test(extensionId)) {
    console.error(`  Error: "${extensionId}" doesn't look like a valid Chrome extension ID.`);
    console.error('  Extension IDs are 32 lowercase letters (e.g. llhnnmoopjffkkbbobjjkkcbhakngdek).');
    process.exit(1);
  }

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
      `chrome-extension://${extensionId}/`,
    ],
  };

  const os = platform();
  if (os === 'darwin' || os === 'linux') {
    const wrapperPath = resolve(manifestDir, 'brms-host');
    const nodeExec = process.execPath;
    writeFileSync(wrapperPath, `#!/bin/sh\nexec "${nodeExec}" "${hostPath}" "$@"\n`, { mode: 0o755 });
    manifest.path = wrapperPath;
  }

  const manifestPath = resolve(manifestDir, `${HOST_NAME}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  if (os === 'win32') {
    console.log('\n[brms] Windows detected. You may need to add a registry key:');
    console.log(`  HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`);
    console.log(`  Value: ${manifestPath}\n`);
  }

  console.log('');
  console.log('  BRMS Native Messaging Host installed successfully!');
  console.log('');
  console.log(`  Extension ID: ${extensionId}`);
  console.log(`  Manifest:     ${manifestPath}`);
  console.log(`  Host:         ${manifest.path}`);
  console.log('');
  console.log('  Next step — add to your project\'s .cursor/mcp.json:');
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
  console.log('Usage: brms-host install --extension-id=<id>');
  console.log('');
  console.log('Commands:');
  console.log('  install    Register the native messaging host for Chrome');
  console.log('');
  console.log('Options:');
  console.log('  --extension-id=<id>  Chrome extension ID (from chrome://extensions)');
  process.exit(1);
}
