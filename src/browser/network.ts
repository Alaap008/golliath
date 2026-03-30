import type { Page, Request, Response } from 'playwright';
import type { NetworkEntry, NetworkFilter } from '../types/index.js';
import { log } from '../utils/logger.js';

const MAX_BUFFER = 500;
const MAX_BODY_SIZE = 32_768; // 32KB cap per body to avoid huge payloads

class NetworkMonitor {
  private entries: NetworkEntry[] = [];
  private attachedPage: Page | null = null;

  attach(page: Page): void {
    if (this.attachedPage === page) return;
    this.detach();

    this.attachedPage = page;
    this.entries = [];

    page.on('requestfinished', this.onRequestFinished);
    page.on('requestfailed', this.onRequestFailed);

    log.info('Network monitor attached');
  }

  detach(): void {
    if (!this.attachedPage) return;
    this.attachedPage.off('requestfinished', this.onRequestFinished);
    this.attachedPage.off('requestfailed', this.onRequestFailed);
    this.attachedPage = null;
    log.info('Network monitor detached');
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

  private onRequestFinished = async (request: Request): Promise<void> => {
    try {
      const response = await request.response();
      this.pushEntry(request, response);
    } catch {
      this.pushEntry(request, null);
    }
  };

  private onRequestFailed = (request: Request): void => {
    this.pushEntry(request, null);
  };

  private pushEntry(request: Request, response: Response | null): void {
    const entry: NetworkEntry = {
      url: request.url(),
      method: request.method(),
      status: null,
      statusText: '',
      headers: {},
      requestHeaders: request.headers(),
      requestBody: request.postData()?.slice(0, MAX_BODY_SIZE) ?? null,
      responseBody: null,
      resourceType: request.resourceType(),
      timing: {
        startTime: Date.now(),
        duration: 0,
      },
      timestamp: Date.now(),
    };

    if (response) {
      entry.status = response.status();
      entry.statusText = response.statusText();
      entry.headers = response.headers();

      response
        .text()
        .then((body) => {
          entry.responseBody = body.slice(0, MAX_BODY_SIZE);
        })
        .catch(() => {});
    }

    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFER) {
      this.entries.shift();
    }
  }
}

export const networkMonitor = new NetworkMonitor();
