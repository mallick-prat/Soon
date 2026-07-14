/**
 * fake provider for tests — injectable message feed, recorded sends,
 * seedable history. no photon, no electron.
 */
import type { ImessageProvider, LocalMessage, SendResult, Unsubscribe } from "./types.js";

export interface RecordedSend {
  conversationRef: string;
  text: string;
  atMs: number;
}

export class FakeProvider implements ImessageProvider {
  started = false;
  readonly sent: RecordedSend[] = [];
  /** when set, sendMessage fails with this code. */
  failNextSendWith: string | undefined;

  private readonly listeners = new Set<(msg: LocalMessage) => void>();
  private readonly history = new Map<string, LocalMessage[]>();
  private nowFn: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.nowFn = options.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  onMessage(cb: (msg: LocalMessage) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** seed history without notifying listeners. */
  seed(msg: LocalMessage): void {
    const list = this.history.get(msg.conversationRef) ?? [];
    list.push(msg);
    this.history.set(msg.conversationRef, list);
  }

  /** inject a live message: recorded in history and fanned out. */
  inject(msg: LocalMessage): void {
    this.seed(msg);
    for (const listener of this.listeners) listener(msg);
  }

  async sendMessage(conversationRef: string, text: string): Promise<SendResult> {
    const sentAtMs = this.nowFn();
    if (this.failNextSendWith !== undefined) {
      const errorCode = this.failNextSendWith;
      this.failNextSendWith = undefined;
      return { ok: false, sentAtMs, errorCode, errorMessage: "fake send failure" };
    }
    this.sent.push({ conversationRef, text, atMs: sentAtMs });
    return { ok: true, sentAtMs, localMessageRef: `fake-sent-${this.sent.length}` };
  }

  async getRecentMessages(conversationRef: string, limit: number, sinceMs: number): Promise<LocalMessage[]> {
    const list = this.history.get(conversationRef) ?? [];
    return list
      .filter((m) => m.sentAtMs >= sinceMs)
      .sort((a, b) => a.sentAtMs - b.sentAtMs)
      .slice(-limit);
  }
}
