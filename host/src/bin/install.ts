#!/usr/bin/env node

/**
 * brms-host CLI
 *
 * Commands:
 *   install  --extension-id=<id>   Register the native messaging host for Chrome
 *   serve                           Start the MCP server on http://localhost:3100/mcp
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
    console.error('  1. Install the BRMS Chrome extension from the Web Store.');
    console.error('');
    console.error('  2. Copy the extension ID from chrome://extensions, then run:');
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
  console.log('  ✓ BRMS native messaging host installed!');
  console.log('');
  console.log(`  Extension ID : ${extensionId}`);
  console.log(`  Manifest     : ${manifestPath}`);
  console.log(`  Host binary  : ${manifest.path}`);
  console.log('');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('  Complete setup (do all 4 steps):');
  console.log('');
  console.log('  2.  Start the MCP server (keep this running):');
  console.log('');
  console.log('        npx brms-host serve');
  console.log('');
  console.log('  3.  Make sure Chrome is open with the BRMS extension');
  console.log('      active. Open the extension popup and add any domains');
  console.log('      you want to inspect (e.g. localhost:3000).');
  console.log('');
  console.log('  4.  Add to your project\'s .cursor/mcp.json:');
  console.log('');
  console.log('        {');
  console.log('          "mcpServers": {');
  console.log('            "brms": {');
  console.log('              "url": "http://localhost:3100/mcp"');
  console.log('            }');
  console.log('          }');
  console.log('        }');
  console.log('');
  console.log('  If the extension popup shows "DISCONNECTED" after');
  console.log('  starting the server, click the Reconnect button in');
  console.log('  the popup or reload the extension.');
  console.log('  ─────────────────────────────────────────────────────');
  console.log('');
}

function printUsage(): void {
  console.log('');
  console.log('  Usage: brms-host <command> [options]');
  console.log('');
  console.log('  Commands:');
  console.log('    install    Register the native messaging host for Chrome');
  console.log('    serve      Start the MCP server on http://localhost:3100/mcp');
  console.log('');
  console.log('  Options (install):');
  console.log('    --extension-id=<id>   Chrome extension ID (from chrome://extensions)');
  console.log('');
  console.log('  Examples:');
  console.log('    npx brms-host install --extension-id=abcdefghijklmnopqrstuvwxyzabcdef');
  console.log('    npx brms-host serve');
  console.log('');
}

const cmd = process.argv[2];

if (cmd === 'install') {
  install();
} else if (cmd === 'serve') {
  console.log('');
  console.log('  Starting BRMS MCP server on http://localhost:3100/mcp');
  console.log('  Press Ctrl+C to stop.');
  console.log('');
  // Dynamic import starts the server (index.js calls main() immediately on load)
  await import('../index.js');
} else {
  printUsage();
  process.exit(cmd ? 1 : 0);
}
