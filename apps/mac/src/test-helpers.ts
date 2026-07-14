/** shared helpers for unit tests (not part of the build — tests only). */
import type { Clock } from "./imessage/debounce.js";
import type { LocalMessage } from "./imessage/types.js";

let refCounter = 0;

export const makeMessage = (overrides: Partial<LocalMessage> = {}): LocalMessage => ({
  ref: `msg-${++refCounter}`,
  conversationRef: "iMessage;-;+15551234567",
  text: "hello",
  sentAtMs: 1_700_000_100_000,
  isFromMe: true,
  isGroup: false,
  participantHandles: ["+15551234567"],
  ...overrides,
});

interface ScheduledTimer {
  id: number;
  at: number;
  fn: () => void;
}

export interface FakeClock extends Clock {
  advance(ms: number): void;
  current(): number;
}

export const createFakeClock = (startMs = 1_700_000_000_000): FakeClock => {
  let now = startMs;
  let nextId = 1;
  const timers: ScheduledTimer[] = [];
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const timer: ScheduledTimer = { id: nextId++, at: now + ms, fn };
      timers.push(timer);
      return timer.id;
    },
    clearTimeout: (handle) => {
      const index = timers.findIndex((t) => t.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
    advance: (ms) => {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (due === undefined) break;
        now = due.at;
        timers.splice(timers.indexOf(due), 1);
        due.fn();
      }
      now = target;
    },
    current: () => now,
  };
};
