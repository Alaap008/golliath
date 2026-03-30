import type { NetworkEntry, NetworkFilter } from '../types/index.js';
import { bridge } from '../bridge/native-messaging.js';
import { log } from '../utils/logger.js';

const MAX_BUFFER = 500;

class NetworkMonitor {
  private entries: NetworkEntry[] = [];
  private listening = false;

  /**
   * Start listening for network_entry push messages from the extension.
   */
  attach(): void {
    if (this.listening) return;
    this.listening = true;
    this.entries = [];

    bridge.onPush('network_entry', (payload) => {
      this.pushEntry(payload as unknown as NetworkEntry);
    });

    log.info('Network monitor attached (push-based)');
  }

  getEntries(filter?: NetworkFilter): NetworkEntry[] {
    let results = [...this.entries];

    if (filter?.urlPattern) {
      const re = new RegExp(filter.urlPattern, 'i');
      results = results.filter((e) => re.test(e.url));
    }
    if (filter?.statusCode !== undefined) {
      results = results.filter((e) => e.status === filter.statusCode);
    }
    if (filter?.resourceType) {
      const rt = filter.resourceType.toLowerCase();
      results = results.filter((e) => e.resourceType.toLowerCase() === rt);
    }

    const limit = filter?.limit ?? results.length;
    return results.slice(-limit);
  }

  clear(): void {
    this.entries = [];
  }

  private pushEntry(entry: NetworkEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFER) {
      this.entries.shift();
    }
  }
}

export const networkMonitor = new NetworkMonitor();
