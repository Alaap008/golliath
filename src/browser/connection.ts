import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { log } from '../utils/logger.js';
import { notConnected, noActivePage } from '../utils/errors.js';
import type { PageInfo } from '../types/index.js';

class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private endpoint: string = 'http://localhost:9222';

  async connect(endpoint?: string): Promise<PageInfo[]> {
    if (endpoint) this.endpoint = endpoint;

    if (this.browser?.isConnected()) {
      log.info('Disconnecting existing browser session');
      await this.browser.close().catch(() => {});
    }

    log.info(`Connecting to browser at ${this.endpoint}`);
    this.browser = await chromium.connectOverCDP(this.endpoint, { timeout: 10000 });

    this.browser.on('disconnected', () => {
      log.warn('Browser disconnected');
      this.browser = null;
      this.context = null;
      this.activePage = null;
    });

    const contexts = this.browser.contexts();
    this.context = contexts[0] ?? null;

    if (!this.context) {
      this.context = await this.browser.newContext();
    }

    const pages = this.context.pages();
    if (pages.length > 0) {
      this.activePage = pages[0];
    }

    log.info(`Connected. Found ${pages.length} page(s)`);
    return this.buildPageList(pages);
  }

  async getPages(): Promise<PageInfo[]> {
    if (!this.browser?.isConnected() || !this.context) throw notConnected();
    return this.buildPageList(this.context.pages());
  }

  async selectPage(index: number): Promise<PageInfo> {
    if (!this.browser?.isConnected() || !this.context) throw notConnected();

    const pages = this.context.pages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Page index ${index} out of range (0–${pages.length - 1})`);
    }

    this.activePage = pages[index];
    const title = await this.activePage.title().catch(() => '');
    log.info(`Selected page ${index}: ${this.activePage.url()}`);

    return { index, title, url: this.activePage.url() };
  }

  getActivePage(): Page {
    if (!this.browser?.isConnected()) throw notConnected();
    if (!this.activePage) throw noActivePage();
    return this.activePage;
  }

  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  private buildPageList(pages: Page[]): PageInfo[] {
    return pages.map((p, i) => ({
      index: i,
      title: '', // title requires async; filled by callers if needed
      url: p.url(),
    }));
  }
}

export const browserManager = new BrowserManager();
