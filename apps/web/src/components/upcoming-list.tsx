"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { UpcomingFilter, UpcomingSessionView } from "@/lib/types";
import {
  CATEGORY_LABELS,
  MEETING_FORMAT_LABELS,
  MEETING_TYPE_LABELS,
  WAITING_ON_LABELS,
} from "@/lib/copy";
import { formatDayTime, formatRelative, initialOf } from "@/lib/format";
import { useAction } from "@/lib/use-action";

const FILTERS: { id: UpcomingFilter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "needs_me", label: "needs me" },
  { id: "waiting_on_them", label: "waiting on them" },
  { id: "follow_up_scheduled", label: "follow-up scheduled" },
  { id: "stalled", label: "stalled" },
  { id: "paused", label: "paused" },
  { id: "personal", label: "personal" },
  { id: "professional", label: "professional" },
];

function matches(session: UpcomingSessionView, filter: UpcomingFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_me":
      return session.category === "needs_user";
    case "waiting_on_them":
      return session.category === "waiting_attendee";
    case "follow_up_scheduled":
      return session.category === "follow_up_scheduled" || session.category === "follow_up_due";
    case "stalled":
      return session.category === "stalled";
    case "paused":
      return session.state === "paused" || session.category === "snoozed";
    case "personal":
      return !session.professional;
    case "professional":
      return session.professional;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function UpcomingList({ sessions }: { sessions: UpcomingSessionView[] }) {
  const [filter, setFilter] = useState<UpcomingFilter>("all");
  const filtered = useMemo(
    () => sessions.filter((s) => matches(s, filter)),
    [sessions, filter],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={clsx("pill cursor-pointer", filter === f.id && "pill-active")}
          >
            {f.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="inset-group px-8 py-16 text-center">
          <p className="text-base text-charcoal">nothing here right now.</p>
          <p className="mt-1 text-sm text-mute">
            react to a message with your trigger emoji in imessage to start one.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {filtered.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionCard({ session }: { session: UpcomingSessionView }) {
  const { run, pending, message } = useAction();
  const act = (body: Record<string, unknown>, label: string) =>
    run(`/api/sessions/${session.id}/actions`, body, label);

  const meta = [
    MEETING_TYPE_LABELS[session.meetingType] ?? session.meetingType,
    `${session.durationMinutes} min`,
    MEETING_FORMAT_LABELS[session.meetingFormat],
    session.location,
  ]
    .filter(Boolean)
    .join(" · ");

  const isPausedish = session.state === "paused" || session.category === "snoozed";
  const needsReview =
    session.state === "awaiting_user_approval" ||
    session.state === "awaiting_follow_up_approval";
  const hasFollowUp = session.nextFollowUpAtIso !== null;

  return (
    <li className="card p-5">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bone text-lg text-ink"
        >
          {initialOf(session.contactName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-ink">{session.contactName}</span>
            <span className="text-sm text-mute">{meta}</span>
            <span className="pill ml-auto">{CATEGORY_LABELS[session.category]}</span>
          </div>
          <p className="mt-1 text-sm text-body">{session.stateLabel}</p>

          {session.lastMessageText && (
            <p className="mt-3 border-l-2 border-hairline pl-3 text-sm text-charcoal">
              {session.lastMessageDirection === "outbound" ? "you: " : ""}
              &ldquo;{session.lastMessageText}&rdquo;
              {session.lastMessageAtIso && (
                <span className="ml-2 text-xs text-ash">
                  {formatRelative(session.lastMessageAtIso)}
                </span>
              )}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
            {session.waitingOn && <span>{WAITING_ON_LABELS[session.waitingOn]}</span>}
            {hasFollowUp && (
              <span>
                next follow-up {formatRelative(session.nextFollowUpAtIso!)}
                {session.followUpMaxAttempts !== null &&
                  ` · attempt ${session.followUpAttemptCount + 1} of ${session.followUpMaxAttempts}`}
              </span>
            )}
            {session.bundle && (
              <span>
                bundle: {session.bundle.messagesUsed} of{" "}
                {session.bundle.maximumOutboundMessages} messages used, expires{" "}
                {formatRelative(session.bundle.expiresAtIso)}
              </span>
            )}
            {session.snoozedUntilIso && (
              <span>snoozed until {formatDayTime(session.snoozedUntilIso)}</span>
            )}
          </div>

          {session.candidateTimes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {session.candidateTimes.slice(0, 4).map((slot) => (
                <span key={slot.id} className="pill font-mono text-[11px]">
                  {formatDayTime(slot.startsAtIso, slot.timezone)}
                </span>
              ))}
            </div>
          )}

          {session.warnings.map((warning) => (
            <p key={warning} className="mt-3 text-xs font-semibold text-charcoal">
              ⚠ {warning}
            </p>
          ))}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            {needsReview && (
              <Link href="/approvals" className="btn-dark btn-sm">
                review draft
              </Link>
            )}
            {hasFollowUp && !isPausedish && (
              <>
                <button
                  type="button"
                  className="btn-outline btn-sm"
                  disabled={pending !== null}
                  onClick={() => act({ action: "send_now" }, "send now")}
                >
                  {pending === "send now" ? "sending…" : "send now"}
                </button>
                <EditFollowUp
                  onPick={(iso) =>
                    act({ action: "edit_next_follow_up", nextAtIso: iso }, "edit follow-up")
                  }
                />
                <Cadence
                  onPick={(hours) =>
                    act({ action: "change_cadence", intervalHours: hours }, "cadence")
                  }
                />
              </>
            )}
            {!isPausedish && (
              <>
                <Snooze
                  onPick={(iso) => act({ action: "snooze", untilIso: iso }, "snooze")}
                />
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={pending !== null}
                  onClick={() => act({ action: "pause" }, "pause")}
                >
                  pause
                </button>
              </>
            )}
            {isPausedish && (
              <button
                type="button"
                className="btn-outline btn-sm"
                disabled={pending !== null}
                onClick={() => act({ action: "resume" }, "resume")}
              >
                {pending === "resume" ? "resuming…" : "resume"}
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pending !== null}
              onClick={() => act({ action: "take_over" }, "take over")}
            >
              take over
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pending !== null}
              onClick={() =>
                act({ action: "close", reason: "scheduled_elsewhere" }, "elsewhere")
              }
            >
              scheduled elsewhere
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-mute"
              disabled={pending !== null}
              onClick={() => act({ action: "close", reason: "no_longer_needed" }, "close")}
            >
              close
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-charcoal">{message}</p>}
        </div>
      </div>
    </li>
  );
}

function Snooze({ onPick }: { onPick: (iso: string) => void }) {
  return (
    <details className="relative">
      <summary className="btn-ghost btn-sm list-none">snooze</summary>
      <div className="card absolute z-10 mt-1 flex w-40 flex-col p-1">
        {[
          { label: "until tomorrow", days: 1 },
          { label: "for 3 days", days: 3 },
          { label: "for a week", days: 7 },
        ].map((option) => (
          <button
            key={option.days}
            type="button"
            className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-bone"
            onClick={() =>
              onPick(new Date(Date.now() + option.days * DAY_MS).toISOString())
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function EditFollowUp({ onPick }: { onPick: (iso: string) => void }) {
  return (
    <details className="relative">
      <summary className="btn-ghost btn-sm list-none">edit next follow-up</summary>
      <div className="card absolute z-10 mt-1 flex w-44 flex-col p-1">
        {[
          { label: "later today", hours: 4 },
          { label: "tomorrow morning", hours: 24 },
          { label: "in 2 days", hours: 48 },
          { label: "next week", hours: 168 },
        ].map((option) => (
          <button
            key={option.hours}
            type="button"
            className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-bone"
            onClick={() =>
              onPick(new Date(Date.now() + option.hours * 60 * 60 * 1000).toISOString())
            }
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function Cadence({ onPick }: { onPick: (hours: number[]) => void }) {
  return (
    <details className="relative">
      <summary className="btn-ghost btn-sm list-none">change cadence</summary>
      <div className="card absolute z-10 mt-1 flex w-52 flex-col p-1">
        {[
          { label: "gentle — 2, 5, 10 days", hours: [48, 120, 240] },
          { label: "persistent — 1, 3, 7 days", hours: [24, 72, 168] },
          { label: "one nudge — 3 days", hours: [72] },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            className="rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-bone"
            onClick={() => onPick(option.hours)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </details>
  );
}
