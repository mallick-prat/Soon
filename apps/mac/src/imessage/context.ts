/**
 * bounded context collection — on activation (or a collect_context command)
 * pull at most 20 messages / 48 hours from the provider and map to the
 * ActivationContext wire shape. never more, regardless of what was asked.
 */
import { CONTEXT_LIMITS, activationContextSchema, type ActivationContext } from "@soon/shared-types";

import type { ImessageProvider, LocalMessage } from "./types.js";

export interface CollectContextOptions {
  conversationRef: string;
  triggerMessageRef: string;
  triggerText: string;
  nowMs: number;
  /** the local user's own handle, when known. */
  userHandle?: string;
  maxMessages?: number;
  maxAgeHours?: number;
}

const HOUR_MS = 3_600_000;

export const collectActivationContext = async (
  provider: ImessageProvider,
  options: CollectContextOptions,
): Promise<ActivationContext> => {
  // hard caps — requests may narrow the bounds, never widen them.
  const maxMessages = Math.min(options.maxMessages ?? CONTEXT_LIMITS.maxMessages, CONTEXT_LIMITS.maxMessages);
  const maxAgeHours = Math.min(options.maxAgeHours ?? CONTEXT_LIMITS.maxAgeHours, CONTEXT_LIMITS.maxAgeHours);
  const sinceMs = options.nowMs - maxAgeHours * HOUR_MS;

  const pulled = await provider.getRecentMessages(options.conversationRef, maxMessages, sinceMs);
  // defensive re-clamp: providers are not trusted to respect the bounds.
  const bounded: LocalMessage[] = pulled
    .filter((m) => m.sentAtMs >= sinceMs && m.sentAtMs <= options.nowMs)
    .sort((a, b) => a.sentAtMs - b.sentAtMs)
    .slice(-maxMessages);

  const attendeeHandles = new Set<string>();
  let isGroup = false;
  for (const m of bounded) {
    if (m.isGroup) isGroup = true;
    if (!m.isFromMe) for (const handle of m.participantHandles) attendeeHandles.add(handle);
  }

  const context: ActivationContext = {
    conversationReference: options.conversationRef,
    triggerMessageReference: options.triggerMessageRef,
    triggerText: options.triggerText,
    messages: bounded.map((m) => ({
      localMessageReference: m.ref,
      senderType: m.isFromMe ? ("user" as const) : ("attendee" as const),
      text: m.text,
      sentAt: new Date(m.sentAtMs).toISOString(),
    })),
    participants: [
      { handle: options.userHandle ?? "me", isUser: true },
      ...[...attendeeHandles].map((handle) => ({ handle, isUser: false })),
    ],
    isGroup,
  };
  return activationContextSchema.parse(context);
};
