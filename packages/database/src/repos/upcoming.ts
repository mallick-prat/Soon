import { getDb } from "../client.js";
import { SchedulingState } from "../generated/prisma/enums.js";
import type { WaitingOn } from "../generated/prisma/enums.js";
import { UNRESOLVED_SESSION_STATES } from "./sessions.js";

/**
 * spec sort for /upcoming:
 *   needs user action → follow-up due today → waiting for attendee
 *   → follow-up scheduled → stalled → snoozed
 */
export const UPCOMING_CATEGORIES = [
  "needs_user",
  "follow_up_due",
  "waiting_attendee",
  "follow_up_scheduled",
  "stalled",
  "snoozed",
] as const;
export type UpcomingCategory = (typeof UPCOMING_CATEGORIES)[number];

/** the minimal shape the pure sorting helpers need — testable without a db */
export interface UpcomingSortable {
  state: SchedulingState;
  waitingOn: WaitingOn | null;
  nextActionAt: Date | null;
  nextActionType: string | null;
  snoozedUntil: Date | null;
  updatedAt: Date;
}

const NEEDS_USER_STATES: readonly SchedulingState[] = [
  SchedulingState.needs_user_input,
  SchedulingState.awaiting_user_approval,
  SchedulingState.awaiting_follow_up_approval,
  SchedulingState.follow_up_sequence_exhausted,
  SchedulingState.taken_over,
];

const WAITING_ATTENDEE_STATES: readonly SchedulingState[] = [
  SchedulingState.waiting_for_attendee,
  SchedulingState.waiting_for_email,
];

const FOLLOW_UP_SCHEDULED_STATES: readonly SchedulingState[] = [
  SchedulingState.scheduling_follow_up,
  SchedulingState.waiting_for_follow_up,
];

function isFollowUpAction(nextActionType: string | null): boolean {
  return nextActionType !== null && nextActionType.includes("follow_up");
}

/** end of the calendar day containing `now`, in UTC */
function endOfDayUtc(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return end;
}

/** classifies a session into its /upcoming bucket. pure. */
export function upcomingCategory(
  session: UpcomingSortable,
  now: Date = new Date(),
): UpcomingCategory {
  if (session.snoozedUntil !== null && session.snoozedUntil > now) {
    return "snoozed";
  }
  if (
    session.waitingOn === "user" ||
    NEEDS_USER_STATES.includes(session.state)
  ) {
    return "needs_user";
  }
  const followUpish =
    session.state === SchedulingState.follow_up_due ||
    session.state === SchedulingState.drafting_follow_up ||
    (isFollowUpAction(session.nextActionType) && session.nextActionAt !== null);
  if (followUpish) {
    const due =
      session.state === SchedulingState.follow_up_due ||
      session.state === SchedulingState.drafting_follow_up ||
      (session.nextActionAt !== null && session.nextActionAt <= endOfDayUtc(now));
    if (due) return "follow_up_due";
  }
  if (
    session.waitingOn === "attendee" ||
    WAITING_ATTENDEE_STATES.includes(session.state)
  ) {
    return "waiting_attendee";
  }
  if (
    FOLLOW_UP_SCHEDULED_STATES.includes(session.state) ||
    (isFollowUpAction(session.nextActionType) && session.nextActionAt !== null)
  ) {
    return "follow_up_scheduled";
  }
  return "stalled";
}

const CATEGORY_RANK: Record<UpcomingCategory, number> = Object.fromEntries(
  UPCOMING_CATEGORIES.map((c, i) => [c, i]),
) as Record<UpcomingCategory, number>;

/**
 * comparator implementing the spec's /upcoming order. within a category:
 * soonest next action first (sessions without one last), then most recently
 * updated first. pure — unit-tested without a database.
 */
export function compareUpcoming(
  a: UpcomingSortable,
  b: UpcomingSortable,
  now: Date = new Date(),
): number {
  const rank = CATEGORY_RANK[upcomingCategory(a, now)] - CATEGORY_RANK[upcomingCategory(b, now)];
  if (rank !== 0) return rank;
  if (a.nextActionAt !== null && b.nextActionAt !== null) {
    const byNext = a.nextActionAt.getTime() - b.nextActionAt.getTime();
    if (byNext !== 0) return byNext;
  } else if (a.nextActionAt !== null) {
    return -1;
  } else if (b.nextActionAt !== null) {
    return 1;
  }
  return b.updatedAt.getTime() - a.updatedAt.getTime();
}

/**
 * every unresolved session for a user, with everything the /upcoming cards
 * need, sorted per spec.
 */
export async function listUpcomingConversations(userId: string, now: Date = new Date()) {
  const db = getDb();
  const sessions = await db.schedulingSession.findMany({
    where: { userId, state: { in: UNRESOLVED_SESSION_STATES } },
    include: {
      conversation: { include: { contact: true } },
      participants: { include: { contact: true } },
      candidateSlots: {
        where: { status: { in: ["candidate", "proposed", "accepted"] } },
        orderBy: { startsAt: "asc" },
      },
      messages: { orderBy: { messageTimestamp: "desc" }, take: 1 },
      drafts: { where: { status: "pending" }, orderBy: { createdAt: "desc" }, take: 1 },
      approvalBundles: { where: { status: "active" }, take: 1 },
      followUpAttempts: { orderBy: { attemptNumber: "asc" } },
      followUpPolicy: true,
    },
  });
  return sessions
    .map((session) => ({ session, category: upcomingCategory(session, now) }))
    .sort((a, b) => compareUpcoming(a.session, b.session, now));
}

export type UpcomingConversation = Awaited<
  ReturnType<typeof listUpcomingConversations>
>[number];
