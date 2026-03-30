import { bridge } from '../bridge/native-messaging.js';
import { log } from '../utils/logger.js';
import { notConnected } from '../utils/errors.js';
import type { PageInfo } from '../types/index.js';

interface TabInfo {
  tabId: number;
  index: number;
  title: string;
  url: string;
}

class BrowserManager {
  private activeTabId: number | null = null;
  private connected = false;

  async connect(): Promise<PageInfo[]> {
    if (!bridge.isConnected()) {
      throw new Error('Native messaging bridge not connected. Ensure the BRMS Chrome Extension is running.');
    }

    const result = await bridge.sendRequest('list_tabs');
    const tabs = (result.tabs ?? []) as TabInfo[];

    if (tabs.length > 0) {
      this.activeTabId = tabs[0].tabId;
      await bridge.sendRequest('select_tab', { tabId: this.activeTabId });
    }

    this.connected = true;
    log.info(`Connected via extension. Found ${tabs.length} tab(s)`);

    return tabs.map((t, i) => ({
      index: i,
      title: t.title,
      url: t.url,
    }));
  }

  async getPages(): Promise<PageInfo[]> {
    if (!this.connected) throw notConnected();

    const result = await bridge.sendRequest('list_tabs');
    const tabs = (result.tabs ?? []) as TabInfo[];

    return tabs.map((t, i) => ({
      index: i,
      title: t.title,
      url: t.url,
    }));
  }

  async selectPage(index: number): Promise<PageInfo> {
    if (!this.connected) throw notConnected();

    const result = await bridge.sendRequest('select_tab', { index }) as unknown as TabInfo;

    this.activeTabId = result.tabId;
    log.info(`Selected tab ${index}: ${result.url}`);

    return { index, title: result.title, url: result.url };
  }

  getActiveTabId(): number {
    if (!this.connected) throw notConnected();
    if (this.activeTabId === null) {
      throw new Error('No active tab selected. Call select_page first.');
    }
    return this.activeTabId;
  }

  isConnected(): boolean {
    return this.connected && bridge.isConnected();
  }
}

export const browserManager = new BrowserManager();
