/**
 * server-side loaders for the dashboard pages. when DATABASE_URL is absent
 * (or the query fails) they fall back to demo fixtures so the ui stays
 * reviewable — pages surface a quiet "demo data" note via `demo: true`.
 */
import {
  getDb,
  isDatabaseConfigured,
  listDraftsAwaitingReview,
  listUpcomingConversations,
} from "@soon/database";
import {
  demoApprovals,
  demoPreferences,
  demoScheduled,
  demoUpcoming,
} from "./demo-data";
import {
  CATEGORY_LABELS,
  OBJECTIVE_LABELS,
  STATE_LABELS,
} from "./copy";
import type {
  ApprovalDraftView,
  PreferencesView,
  ScheduledEventView,
  UpcomingSessionView,
} from "./types";
import { auth } from "@/auth";

export interface LoadResult<T> {
  data: T;
  demo: boolean;
}

const PROFESSIONAL_RELATIONSHIPS = new Set([
  "founder",
  "investor",
  "colleague",
  "mentor",
  "professional_contact",
]);

const MAC_STALE_MS = 30 * 60 * 1000;

async function firstUserId(): Promise<string | null> {
  const db = getDb();
  const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
  return user?.id ?? null;
}

export interface CalendarConnectionView {
  connected: boolean;
  email: string | null;
  status: string | null;
}

/** the current google calendar connection (email + status), if any. */
export async function loadCalendarConnection(): Promise<CalendarConnectionView> {
  const disconnected = { connected: false, email: null, status: null };
  if (!isDatabaseConfigured()) return disconnected;
  try {
    const userId = await firstUserId();
    if (userId === null) return disconnected;
    const conn = await getDb().googleConnection.findUnique({ where: { userId } });
    if (conn === null) return disconnected;
    let email = conn.googleAccountEmail;
    if (email === null) {
      // connections stored before we captured the email fall back to the
      // signed-in google account (the one that authorized the calendar).
      const session = await auth();
      email = session?.user?.email ?? null;
    }
    return { connected: conn.status === "connected", email, status: conn.status };
  } catch {
    return disconnected;
  }
}

async function macWarnings(userId: string): Promise<string[]> {
  const db = getDb();
  const device = await db.macDevice.findFirst({
    where: { userId },
    orderBy: { lastSeenAt: "desc" },
  });
  if (!device) return ["no mac paired yet — messages can't be sent"];
  if (device.status === "revoked") return ["mac access was revoked"];
  if (device.messagesPermissionStatus === "denied")
    return ["mac needs messages permission — check system settings"];
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > MAC_STALE_MS)
    return ["mac needs to reconnect"];
  return [];
}

export async function loadUpcoming(): Promise<LoadResult<UpcomingSessionView[]>> {
  if (!isDatabaseConfigured()) return { data: demoUpcoming(), demo: true };
  try {
    const userId = await firstUserId();
    if (!userId) return { data: [], demo: false };
    const warnings = await macWarnings(userId);
    const rows = await listUpcomingConversations(userId);
    const data: UpcomingSessionView[] = rows.map(({ session, category }) => {
      const contact = session.conversation.contact;
      const participant = session.participants[0];
      const lastMessage = session.messages[0] ?? null;
      const sentAttempts = session.followUpAttempts.filter((a) =>
        ["sent", "acknowledged"].includes(a.status),
      ).length;
      const nextScheduledAttempt = session.followUpAttempts.find((a) =>
        ["scheduled", "awaiting_approval", "approved"].includes(a.status),
      );
      const bundle = session.approvalBundles[0] ?? null;
      return {
        id: session.id,
        contactName:
          contact?.displayName ??
          participant?.displayName ??
          participant?.handle ??
          "unknown contact",
        state: session.state,
        stateLabel: STATE_LABELS[session.state] ?? session.state,
        category,
        meetingType: session.meetingType,
        durationMinutes: session.durationMinutes,
        meetingFormat: session.meetingFormat,
        location: session.location,
        waitingOn: session.waitingOn,
        lastMessageText: lastMessage?.sanitizedText ?? null,
        lastMessageDirection: lastMessage?.direction ?? null,
        lastMessageAtIso: lastMessage?.messageTimestamp.toISOString() ?? null,
        nextFollowUpAtIso:
          session.nextActionType?.includes("follow_up") && session.nextActionAt
            ? session.nextActionAt.toISOString()
            : (nextScheduledAttempt?.scheduledFor.toISOString() ?? null),
        followUpAttemptCount: sentAttempts,
        followUpMaxAttempts: session.followUpPolicy?.maximumAttempts ?? null,
        candidateTimes: session.candidateSlots.map((slot) => ({
          id: slot.id,
          startsAtIso: slot.startsAt.toISOString(),
          endsAtIso: slot.endsAt.toISOString(),
          timezone: slot.timezone,
          status: slot.status,
        })),
        bundle: bundle
          ? {
              id: bundle.id,
              messagesUsed: bundle.messagesUsed,
              maximumOutboundMessages: bundle.maximumOutboundMessages,
              expiresAtIso: bundle.expiresAt.toISOString(),
              status: bundle.status,
            }
          : null,
        warnings,
        professional: PROFESSIONAL_RELATIONSHIPS.has(
          contact?.relationshipType ?? "unknown",
        ),
        snoozedUntilIso: session.snoozedUntil?.toISOString() ?? null,
        updatedAtIso: session.updatedAt.toISOString(),
      };
    });
    return { data, demo: false };
  } catch {
    return { data: demoUpcoming(), demo: true };
  }
}

export async function loadApprovals(): Promise<LoadResult<ApprovalDraftView[]>> {
  if (!isDatabaseConfigured()) return { data: demoApprovals(), demo: true };
  try {
    const userId = await firstUserId();
    if (!userId) return { data: [], demo: false };
    const drafts = await listDraftsAwaitingReview(userId);
    const data: ApprovalDraftView[] = drafts.map((draft) => {
      const contact = draft.session.conversation.contact;
      const participant = draft.session.participants[0];
      const alternatives = Array.isArray(draft.alternativeTexts)
        ? (draft.alternativeTexts as string[])
        : [];
      const contactName =
        contact?.displayName ??
        participant?.displayName ??
        participant?.handle ??
        "unknown contact";
      return {
        id: draft.id,
        sessionId: draft.sessionId,
        contactName,
        objective: draft.objective,
        objectiveLabel: OBJECTIVE_LABELS[draft.objective] ?? draft.objective,
        proposedText: draft.editedText ?? draft.text,
        alternativeTexts: alternatives,
        contextSummary: `${CATEGORY_LABELS.needs_user}: ${
          STATE_LABELS[draft.session.state] ?? draft.session.state
        } · round ${draft.session.proposalRound}`,
        candidateTimes: draft.session.candidateSlots.map((slot) => ({
          id: slot.id,
          startsAtIso: slot.startsAt.toISOString(),
          endsAtIso: slot.endsAt.toISOString(),
          timezone: slot.timezone,
          status: slot.status,
        })),
        confidence: draft.confidence,
        expiresAtIso: draft.expiresAt.toISOString(),
        meetingType: draft.session.meetingType,
        durationMinutes: draft.session.durationMinutes,
      };
    });
    return { data, demo: false };
  } catch {
    return { data: demoApprovals(), demo: true };
  }
}

export async function loadScheduled(): Promise<LoadResult<ScheduledEventView[]>> {
  if (!isDatabaseConfigured()) return { data: demoScheduled(), demo: true };
  try {
    const userId = await firstUserId();
    if (!userId) return { data: [], demo: false };
    const db = getDb();
    const sessions = await db.schedulingSession.findMany({
      where: { userId, state: "scheduled" },
      include: {
        conversation: { include: { contact: true } },
        participants: true,
        candidateSlots: { where: { status: "booked" }, take: 1 },
      },
      orderBy: { completedAt: "desc" },
    });
    const prefs = await db.calendarPreference.findUnique({ where: { userId } });
    const data: ScheduledEventView[] = sessions.map((session) => {
      const contactName =
        session.conversation.contact?.displayName ??
        session.participants[0]?.displayName ??
        "unknown contact";
      const slot = session.candidateSlots[0] ?? null;
      return {
        sessionId: session.id,
        title: session.title ?? `${session.meetingType.replace("_", " ")} with ${contactName}`,
        attendeeName: contactName,
        startsAtIso: slot?.startsAt.toISOString() ?? null,
        endsAtIso: slot?.endsAt.toISOString() ?? null,
        timezone: session.timezone,
        location: session.location,
        meetingFormat: session.meetingFormat,
        calendarName: prefs?.destinationCalendarId ?? "primary",
        calendarEventId: session.calendarEventId,
        status: session.participants.some((p) => p.email) ? "confirmed" : "pending_invite",
      };
    });
    return { data, demo: false };
  } catch {
    return { data: demoScheduled(), demo: true };
  }
}

export async function loadPreferences(): Promise<LoadResult<PreferencesView>> {
  if (!isDatabaseConfigured()) return { data: demoPreferences(), demo: true };
  try {
    const db = getDb();
    const user = await db.user.findFirst({
      orderBy: { createdAt: "asc" },
      include: {
        calendarPreference: true,
        stylePreference: true,
        googleConnection: true,
        macDevices: { orderBy: { lastSeenAt: "desc" }, take: 1 },
      },
    });
    if (!user) return { data: demoPreferences(), demo: true };
    const cal = user.calendarPreference;
    const workingHours = Array.isArray(cal?.workingHoursJson)
      ? (cal.workingHoursJson as { weekday: number; start: string; end: string }[])
      : [];
    const followUpIntervals = Array.isArray(cal?.followUpDelaysJson)
      ? (cal.followUpDelaysJson as number[])
      : [48, 120, 240];
    const quietHours =
      cal?.quietHoursJson && typeof cal.quietHoursJson === "object"
        ? (cal.quietHoursJson as { earliest: string; latest: string })
        : { earliest: "09:00", latest: "19:00" };
    const mac = user.macDevices[0] ?? null;
    const data: PreferencesView = {
      timezone: user.timezone,
      approvalMode: user.approvalMode,
      triggerEmoji: user.triggerEmoji,
      followUpDefaultEnabled: user.followUpDefaultEnabled,
      workingHours,
      minimumNoticeMinutes: cal?.minimumNoticeMinutes ?? 120,
      maximumMeetingsPerDay: cal?.maximumMeetingsPerDay ?? 8,
      weekendEnabled: cal?.weekendEnabled ?? false,
      videoDefault: cal?.videoDefault ?? "meet",
      destinationCalendarId: cal?.destinationCalendarId ?? "primary",
      styleMode: user.stylePreference?.mode ?? "adaptive",
      followUpIntervalHours: followUpIntervals,
      quietHours,
      connections: {
        google: {
          status: user.googleConnection?.status ?? "not_connected",
          email: user.googleConnection?.googleAccountEmail ?? null,
          lastSyncIso: user.googleConnection?.lastSyncAt?.toISOString() ?? null,
        },
        mac: {
          status: mac?.status ?? "not_paired",
          deviceName: mac?.deviceName ?? null,
          lastSeenIso: mac?.lastSeenAt?.toISOString() ?? null,
          messagesPermission: mac?.messagesPermissionStatus ?? "unknown",
          appVersion: mac?.appVersion ?? null,
        },
      },
    };
    return { data, demo: false };
  } catch {
    return { data: demoPreferences(), demo: true };
  }
}
