/**
 * fragment batching — people send thoughts as bursts of short messages.
 * fragments arriving close together are collapsed into one interpretation
 * unit per conversation: 3s window normally, 8s once the attendee has
 * started replying to proposed times (they may still be typing).
 */
import type { LocalMessage } from "./types.js";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export const DEFAULT_BATCH_WINDOW_MS = 3_000;
export const EXTENDED_BATCH_WINDOW_MS = 8_000;

export type BatchHandler = (conversationRef: string, messages: LocalMessage[]) => void;

interface PendingBatch {
  messages: LocalMessage[];
  timer: unknown;
}

export interface FragmentBatcherOptions {
  onBatch: BatchHandler;
  clock?: Clock;
  windowMs?: number;
  extendedWindowMs?: number;
}

export class FragmentBatcher {
  private readonly onBatch: BatchHandler;
  private readonly clock: Clock;
  private readonly windowMs: number;
  private readonly extendedWindowMs: number;
  private readonly pending = new Map<string, PendingBatch>();
  private readonly extended = new Set<string>();

  constructor(options: FragmentBatcherOptions) {
    this.onBatch = options.onBatch;
    this.clock = options.clock ?? systemClock;
    this.windowMs = options.windowMs ?? DEFAULT_BATCH_WINDOW_MS;
    this.extendedWindowMs = options.extendedWindowMs ?? EXTENDED_BATCH_WINDOW_MS;
  }

  /** add a fragment; (re)starts that conversation's window. */
  push(msg: LocalMessage): void {
    const key = msg.conversationRef;
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      this.clock.clearTimeout(existing.timer);
      existing.messages.push(msg);
      existing.timer = this.startTimer(key);
      return;
    }
    this.pending.set(key, { messages: [msg], timer: this.startTimer(key) });
  }

  /**
   * widen (or restore) the window for a conversation — call with true when
   * the attendee begins replying to proposed times.
   */
  setAttendeeReplying(conversationRef: string, replying: boolean): void {
    if (replying) this.extended.add(conversationRef);
    else this.extended.delete(conversationRef);
  }

  /** flush one conversation (or all) immediately. */
  flush(conversationRef?: string): void {
    const keys = conversationRef === undefined ? [...this.pending.keys()] : [conversationRef];
    for (const key of keys) this.emit(key);
  }

  dispose(): void {
    for (const batch of this.pending.values()) this.clock.clearTimeout(batch.timer);
    this.pending.clear();
    this.extended.clear();
  }

  private startTimer(key: string): unknown {
    const ms = this.extended.has(key) ? this.extendedWindowMs : this.windowMs;
    return this.clock.setTimeout(() => this.emit(key), ms);
  }

  private emit(key: string): void {
    const batch = this.pending.get(key);
    if (batch === undefined) return;
    this.pending.delete(key);
    this.clock.clearTimeout(batch.timer);
    if (batch.messages.length > 0) this.onBatch(key, batch.messages);
  }
}
