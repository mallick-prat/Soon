/**
 * default product copy. all lowercase by design — soon speaks quietly.
 * templates interpolate with {name}-style placeholders via renderCopy.
 */

export const notificationCopy = {
  handling: "soon is handling this",
  draftingTimes: "drafting times for {name}",
  scheduledWith: "scheduled with {name}",
  couldntLand: "couldn't land this one",
  reconnectCalendar: "reconnect google calendar",
  alreadyHandling: "already handling this conversation",
  keepTrying: "keep trying with {name}?",
  takenOver: "you've taken over — soon is standing by",
  resumed: "soon is back on it",
  cancelled: "cancelled — nothing on the calendar",
  undone: "undone",
  awaitingApproval: "draft ready for {name} — approve to send",
  waitingOnReply: "waiting on {name}",
  slotAccepted: "{name} picked a time",
  needsYourCall: "needs your call — reply to choose",
  expired: "this one went quiet",
} as const;

export const statusCopy = {
  idle: "nothing in flight",
  proposing: "times proposed — waiting on {name}",
  confirming: "confirming with {name}",
  booked: "booked with {name}",
  paused: "paused — you're driving",
} as const;

export const onboardingCopy = {
  headline: "scheduling that lives in your texts",
  subheadline: "one emoji hands the back-and-forth to soon",
  pickTriggerHeadline: "pick your trigger",
  pickTriggerBody: "send it in any conversation and soon takes it from there",
  connectCalendarHeadline: "connect google calendar",
  connectCalendarBody: "soon only offers times you're actually free",
  styleHeadline: "it sounds like you",
  styleBody: "soon learns how you text and drafts in your voice",
  doneHeadline: "you're set",
  doneBody: "text like you always do. soon handles the rest.",
} as const;

export type CopyTemplate = string;

/** simple {name}-style interpolation; unknown placeholders are left intact */
export function renderCopy(template: CopyTemplate, vars: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : placeholder;
  });
}
