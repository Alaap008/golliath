import type { ConsoleEntry } from '../types/index.js';
import { bridge } from '../bridge/native-messaging.js';
import { log } from '../utils/logger.js';

const MAX_BUFFER = 200;

type ConsoleLevel = ConsoleEntry['level'];

class ConsoleCapture {
  private entries: ConsoleEntry[] = [];
  private listening = false;

  /**
   * Start listening for console_entry push messages from the extension.
   */
  attach(): void {
    if (this.listening) return;
    this.listening = true;
    this.entries = [];

    bridge.onPush('console_entry', (payload) => {
      this.push(payload as unknown as ConsoleEntry);
    });

    log.info('Console capture attached (push-based)');
  }

  getEntries(level?: ConsoleLevel, limit?: number): ConsoleEntry[] {
    let results = [...this.entries];

    if (level) {
      results = results.filter((e) => e.level === level);
    }

    if (limit !== undefined) {
      results = results.slice(-limit);
    }

    return results;
  }

  getErrors(limit?: number): ConsoleEntry[] {
    return this.getEntries('error', limit);
  }

  clear(): void {
    this.entries = [];
  }

  private push(entry: ConsoleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFER) {
      this.entries.shift();
    }
  }
}

export const consoleCapture = new ConsoleCapture();
