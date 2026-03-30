/**
 * Native Messaging bridge: communicates with the Chrome extension
 * using Chrome's 4-byte little-endian length-prefixed JSON protocol
 * over stdin/stdout.
 */

import { randomUUID } from 'node:crypto';
import { log } from '../utils/logger.js';

const REQUEST_TIMEOUT_MS = 30_000;

type PushHandler = (payload: Record<string, unknown>) => void;

interface PendingRequest {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class NativeMessagingBridge {
  private pending = new Map<string, PendingRequest>();
  private pushHandlers = new Map<string, PushHandler[]>();
  private readBuffer = Buffer.alloc(0);
  private connected = false;

  start(): void {
    if (this.connected) return;
    this.connected = true;

    process.stdin.on('data', (chunk: Buffer) => {
      this.readBuffer = Buffer.concat([this.readBuffer, chunk]);
      this.drain();
    });

    process.stdin.on('end', () => {
      log.warn('Native messaging stdin closed');
      this.connected = false;
      for (const [, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error('Extension disconnected'));
      }
      this.pending.clear();
    });

    log.info('Native messaging bridge started');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a request to the extension and await the response.
   */
  sendRequest(type: string, payload: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      this.write({ id, kind: 'request', type, payload });
    });
  }

  /**
   * Register a handler for push messages from the extension.
   */
  onPush(type: string, handler: PushHandler): void {
    const handlers = this.pushHandlers.get(type) ?? [];
    handlers.push(handler);
    this.pushHandlers.set(type, handlers);
  }

  private write(msg: Record<string, unknown>): void {
    const json = JSON.stringify(msg);
    const body = Buffer.from(json, 'utf-8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    process.stdout.write(Buffer.concat([header, body]));
  }

  private drain(): void {
    while (this.readBuffer.length >= 4) {
      const msgLen = this.readBuffer.readUInt32LE(0);
      if (this.readBuffer.length < 4 + msgLen) break;

      const jsonBuf = this.readBuffer.subarray(4, 4 + msgLen);
      this.readBuffer = this.readBuffer.subarray(4 + msgLen);

      try {
        const msg = JSON.parse(jsonBuf.toString('utf-8'));
        this.handleMessage(msg);
      } catch (err) {
        log.error('Failed to parse native message', err);
      }
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const kind = msg.kind as string;

    if (kind === 'response') {
      const id = msg.id as string;
      const pending = this.pending.get(id);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pending.delete(id);

      if (msg.error) {
        pending.reject(new Error(msg.error as string));
      } else {
        pending.resolve((msg.payload ?? {}) as Record<string, unknown>);
      }
      return;
    }

    if (kind === 'push') {
      const type = msg.type as string;
      const handlers = this.pushHandlers.get(type);
      if (handlers) {
        const payload = (msg.payload ?? {}) as Record<string, unknown>;
        for (const h of handlers) {
          try { h(payload); } catch (err) { log.error(`Push handler error (${type})`, err); }
        }
      }
      return;
    }

    log.warn('Unknown message kind:', kind);
  }
}

export const bridge = new NativeMessagingBridge();
