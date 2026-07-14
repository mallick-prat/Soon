import { matchTriggerPrefix } from "./trigger.js";

export type TriggerCommand =
  | { kind: "stop" }
  | { kind: "status" }
  | { kind: "take_over" }
  | { kind: "resume" }
  | { kind: "cancel" }
  | { kind: "undo" }
  | { kind: "approve"; count: number };

const SIMPLE_COMMANDS: Record<string, Exclude<TriggerCommand["kind"], "approve">> = {
  stop: "stop",
  status: "status",
  "take over": "take_over",
  takeover: "take_over",
  resume: "resume",
  cancel: "cancel",
  undo: "undo",
};

/**
 * parse "<trigger> <command>" messages, e.g. "📅 stop" or "📅 approve 3".
 * returns null for standalone triggers, modifier text, and non-trigger messages.
 */
export function parseCommand(messageText: string, trigger: string): TriggerCommand | null {
  const rest = matchTriggerPrefix(messageText, trigger);
  if (rest === null || rest === "") return null;

  const normalized = rest.toLowerCase().replace(/\s+/g, " ").trim();

  const simple = SIMPLE_COMMANDS[normalized];
  if (simple !== undefined) return { kind: simple };

  const approve = /^approve(?: (\d+))?$/.exec(normalized);
  if (approve) {
    const count = approve[1] !== undefined ? Number.parseInt(approve[1], 10) : 1;
    if (count > 0) return { kind: "approve", count };
  }

  return null;
}
