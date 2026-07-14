import type { ActivationContext, ContextMessage } from "@soon/shared-types";

let refCounter = 0;
const ref = () => `msg-${++refCounter}`;

export function makeMessage(
  senderType: "user" | "attendee",
  text: string,
  sentAt: string,
): ContextMessage {
  return { localMessageReference: ref(), senderType, text, sentAt };
}

export function makeContext(
  messages: Array<[sender: "user" | "attendee", text: string, sentAt: string]>,
  overrides: Partial<ActivationContext> = {},
): ActivationContext {
  return {
    conversationReference: "conv-1",
    triggerMessageReference: "trigger-1",
    triggerText: "📅",
    messages: messages.map(([s, t, at]) => makeMessage(s, t, at)),
    participants: [
      { handle: "+15551230000", displayName: "prat", isUser: true },
      { handle: "+15551234567", displayName: "alex chen", isUser: false },
    ],
    isGroup: false,
    ...overrides,
  };
}

/**
 * canonical conversation fixtures from the spec's simulation list.
 * timestamps are relative to a monday-noon "now" of 2026-07-13T16:00:00Z.
 */
export const FIXTURES = {
  immediateAcceptance: makeContext([
    ["user", "would be great to catch up sometime next week", "2026-07-13T15:50:00Z"],
    ["attendee", "yes definitely", "2026-07-13T15:55:00Z"],
  ]),

  coffeeInBoston: makeContext([
    ["attendee", "let's grab coffee when you're back in boston", "2026-07-13T14:00:00Z"],
    ["user", "yes! would love that", "2026-07-13T14:05:00Z"],
  ]),

  quickCallTomorrow: makeContext([
    ["attendee", "can we do a quick call tomorrow afternoon?", "2026-07-13T15:00:00Z"],
    ["user", "sure", "2026-07-13T15:01:00Z"],
  ]),

  emailAlreadyKnown: makeContext([
    ["user", "i'll send over an invite", "2026-07-13T15:00:00Z"],
    ["attendee", "great, use alex@example.com", "2026-07-13T15:02:00Z"],
    ["user", "perfect", "2026-07-13T15:03:00Z"],
  ]),

  sensitiveTopic: makeContext([
    ["attendee", "i'd rather talk about the diagnosis in person", "2026-07-13T15:00:00Z"],
    ["user", "of course. let's find a time", "2026-07-13T15:01:00Z"],
  ]),

  unrelatedChatter: makeContext([
    ["attendee", "did you watch the game last night", "2026-07-13T15:00:00Z"],
    ["user", "hahaha yes unreal", "2026-07-13T15:01:00Z"],
    ["user", "we should catch up next week", "2026-07-13T15:02:00Z"],
    ["attendee", "for sure", "2026-07-13T15:03:00Z"],
  ]),

  groupConversation: makeContext(
    [
      ["user", "we should all get dinner", "2026-07-13T15:00:00Z"],
      ["attendee", "in!", "2026-07-13T15:01:00Z"],
    ],
    {
      isGroup: true,
      participants: [
        { handle: "+15551230000", displayName: "prat", isUser: true },
        { handle: "+15551234567", displayName: "alex chen", isUser: false },
        { handle: "+15559876543", displayName: "sarah kim", isUser: false },
      ],
    },
  ),
} as const;

/** attendee replies used to exercise interpretation and negotiation */
export const REPLIES = {
  acceptFirst: "the first one",
  acceptTuesday: "tuesday works",
  acceptBareTime: "3 works",
  ambiguousYes: "yes",
  rejectAll: "none of those work",
  laterFriday: "can you do later friday",
  travelingNextWeek: "i'm traveling next week",
  tomorrowMorning: "what about tomorrow morning",
  afterFive: "after 5 would be better",
  makeItZoom: "actually can we do zoom",
  makeIt45: "make it 45 minutes",
  addAttendee: "can sarah join too",
  provideEmail: "alex@example.com",
  provideEmailWithPunctuation: "sure — alex@example.com.",
  reschedule: "something came up, can we push this",
  cancel: "so sorry, need to cancel",
  optOut: "please stop messaging me about this",
  confusion: "wait what times did you mean?",
  unrelated: "lol did you see the game",
} as const;
