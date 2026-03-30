import type { Page, ConsoleMessage } from 'playwright';
import type { ConsoleEntry } from '../types/index.js';
import { log } from '../utils/logger.js';

const MAX_BUFFER = 200;

type ConsoleLevel = ConsoleEntry['level'];

const LEVEL_MAP: Record<string, ConsoleLevel> = {
  log: 'log',
  warning: 'warn',
  error: 'error',
  info: 'info',
  debug: 'debug',
};

class ConsoleCapture {
  private entries: ConsoleEntry[] = [];
  private attachedPage: Page | null = null;

  attach(page: Page): void {
    if (this.attachedPage === page) return;
    this.detach();

    this.attachedPage = page;
    this.entries = [];

    page.on('console', this.onConsole);
    page.on('pageerror', this.onPageError);

    log.info('Console capture attached');
  }

  detach(): void {
    if (!this.attachedPage) return;
    this.attachedPage.off('console', this.onConsole);
    this.attachedPage.off('pageerror', this.onPageError);
    this.attachedPage = null;
    log.info('Console capture detached');
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

  private onConsole = (msg: ConsoleMessage): void => {
    const level = LEVEL_MAP[msg.type()] ?? 'log';
    const location = msg.location();

    this.push({
      level,
      text: msg.text(),
      timestamp: Date.now(),
      location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null,
    });
  };

  private onPageError = (err: Error): void => {
    this.push({
      level: 'error',
      text: err.stack || err.message,
      timestamp: Date.now(),
      location: null,
    });
  };

  private push(entry: ConsoleEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFER) {
      this.entries.shift();
    }
  }
}

export const consoleCapture = new ConsoleCapture();
