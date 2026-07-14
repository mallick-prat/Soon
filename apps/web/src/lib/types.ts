import type {
  ApprovalMode,
  MeetingFormat,
  MeetingType,
  SchedulingState,
} from "@soon/shared-types";

/** the /upcoming sort buckets, in spec order */
export type UpcomingCategory =
  | "needs_user"
  | "follow_up_due"
  | "waiting_attendee"
  | "follow_up_scheduled"
  | "stalled"
  | "snoozed";

export type UpcomingFilter =
  | "all"
  | "needs_me"
  | "waiting_on_them"
  | "follow_up_scheduled"
  | "stalled"
  | "paused"
  | "personal"
  | "professional";

export interface CandidateTimeView {
  id: string;
  startsAtIso: string;
  endsAtIso: string;
  timezone: string;
  status: string;
}

export interface BundleView {
  id: string;
  messagesUsed: number;
  maximumOutboundMessages: number;
  expiresAtIso: string;
  status: string;
}

/** serializable card model for /upcoming */
export interface UpcomingSessionView {
  id: string;
  contactName: string;
  state: SchedulingState;
  stateLabel: string;
  category: UpcomingCategory;
  meetingType: MeetingType;
  durationMinutes: number;
  meetingFormat: MeetingFormat;
  location: string | null;
  waitingOn: "user" | "attendee" | "system" | null;
  lastMessageText: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageAtIso: string | null;
  nextFollowUpAtIso: string | null;
  followUpAttemptCount: number;
  followUpMaxAttempts: number | null;
  candidateTimes: CandidateTimeView[];
  bundle: BundleView | null;
  warnings: string[];
  professional: boolean;
  snoozedUntilIso: string | null;
  updatedAtIso: string;
}

/** serializable card model for /approvals */
export interface ApprovalDraftView {
  id: string;
  sessionId: string;
  contactName: string;
  objective: string;
  objectiveLabel: string;
  proposedText: string;
  alternativeTexts: string[];
  contextSummary: string;
  candidateTimes: CandidateTimeView[];
  confidence: number;
  expiresAtIso: string;
  meetingType: MeetingType;
  durationMinutes: number;
}

/** serializable row model for /scheduled */
export interface ScheduledEventView {
  sessionId: string;
  title: string;
  attendeeName: string;
  startsAtIso: string | null;
  endsAtIso: string | null;
  timezone: string;
  location: string | null;
  meetingFormat: MeetingFormat;
  calendarName: string;
  calendarEventId: string | null;
  status: "confirmed" | "pending_invite";
}

export interface PreferencesView {
  timezone: string;
  approvalMode: ApprovalMode;
  triggerEmoji: string;
  followUpDefaultEnabled: boolean;
  workingHours: { weekday: number; start: string; end: string }[];
  minimumNoticeMinutes: number;
  maximumMeetingsPerDay: number;
  weekendEnabled: boolean;
  videoDefault: string;
  destinationCalendarId: string;
  styleMode: string;
  followUpIntervalHours: number[];
  quietHours: { earliest: string; latest: string };
  connections: {
    google: { status: string; email: string | null; lastSyncIso: string | null };
    mac: {
      status: string;
      deviceName: string | null;
      lastSeenIso: string | null;
      messagesPermission: string;
      appVersion: string | null;
    };
  };
}
