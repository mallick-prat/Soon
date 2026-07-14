"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { PreferencesView } from "@/lib/types";
import { formatRelative } from "@/lib/format";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const MEETING_PRESETS = [
  { type: "quick call", duration: "15 min", format: "phone or video" },
  { type: "catch-up", duration: "30 min", format: "video" },
  { type: "coffee", duration: "45 min", format: "in person" },
  { type: "lunch", duration: "60 min", format: "in person" },
  { type: "dinner", duration: "90 min", format: "in person" },
  { type: "meeting", duration: "30 min", format: "video" },
];

export function PreferencesPanel({ prefs }: { prefs: PreferencesView }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function save(body: Record<string, unknown>) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.status === 503) {
        setNotice("no database connected — changes are disabled in demo mode");
      } else if (!response.ok) {
        setNotice("could not save — try again");
      } else {
        setNotice("saved");
        router.refresh();
      }
    } catch {
      setNotice("network error — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {notice && (
        <p className="sticky top-16 z-10 self-start rounded-full border border-hairline bg-bone px-3 py-1 text-xs text-charcoal">
          {notice}
        </p>
      )}

      <Section title="availability" lead="when soon is allowed to offer your time.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="working hours">
            <div className="flex flex-wrap gap-1.5">
              {prefs.workingHours.length === 0 ? (
                <span className="text-sm text-ash">not set</span>
              ) : (
                prefs.workingHours.map((wh) => (
                  <span key={wh.weekday} className="pill font-mono text-[11px]">
                    {WEEKDAYS[wh.weekday]} {wh.start}–{wh.end}
                  </span>
                ))
              )}
            </div>
          </Field>
          <Field label="minimum notice">
            <span className="text-sm text-body">
              {Math.round(prefs.minimumNoticeMinutes / 60)} hours before any new meeting
            </span>
          </Field>
          <Field label="busiest day allowed">
            <span className="text-sm text-body">
              up to {prefs.maximumMeetingsPerDay} meetings per day
            </span>
          </Field>
          <Field label="weekends">
            <Toggle
              checked={prefs.weekendEnabled}
              disabled={saving}
              onChange={(v) => save({ calendar: { weekendEnabled: v } })}
              labelOn="soon may offer weekend times"
              labelOff="weekends are off-limits"
            />
          </Field>
        </div>
      </Section>

      <Section title="meeting defaults" lead="what each kind of meeting means.">
        <div className="card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-hairline text-xs text-mute">
                <th className="px-4 py-2.5 font-semibold">preset</th>
                <th className="px-4 py-2.5 font-semibold">duration</th>
                <th className="px-4 py-2.5 font-semibold">format</th>
              </tr>
            </thead>
            <tbody>
              {MEETING_PRESETS.map((preset) => (
                <tr key={preset.type} className="border-b border-hairline last:border-0">
                  <td className="px-4 py-2.5 font-semibold text-ink">{preset.type}</td>
                  <td className="px-4 py-2.5 font-mono text-[12px] text-charcoal">
                    {preset.duration}
                  </td>
                  <td className="px-4 py-2.5 text-charcoal">{preset.format}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-mute">
          video meetings default to {prefs.videoDefault === "meet" ? "google meet" : "no link"}.
        </p>
      </Section>

      <Section title="communication style" lead="how soon sounds when it writes as you.">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "adaptive", label: "match how i text each person" },
            { id: "fixed", label: "keep one consistent tone" },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              disabled={saving}
              onClick={() => save({ style: { mode: mode.id } })}
              className={clsx("pill cursor-pointer", prefs.styleMode === mode.id && "pill-active")}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="approvals" lead="how much soon checks in before sending.">
        <div className="flex flex-col gap-2">
          {[
            {
              id: "approve_every",
              label: "approve every message",
              hint: "nothing is sent without you seeing it first",
            },
            {
              id: "bundle",
              label: "approve in bundles",
              hint: "ok a plan once; soon sends a few messages within it",
            },
            {
              id: "calendar_only",
              label: "calendar only",
              hint: "soon never texts anyone — it only holds and creates events",
            },
          ].map((mode) => (
            <button
              key={mode.id}
              type="button"
              disabled={saving}
              onClick={() => save({ approvalMode: mode.id })}
              className={clsx(
                "card cursor-pointer p-4 text-left transition-colors",
                prefs.approvalMode === mode.id && "border-hairline-strong",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span
                  aria-hidden
                  className={clsx(
                    "inline-block h-2.5 w-2.5 rounded-full border border-hairline-strong",
                    prefs.approvalMode === mode.id && "bg-surface-dark",
                  )}
                />
                {mode.label}
              </span>
              <span className="mt-0.5 block pl-[18px] text-xs text-mute">{mode.hint}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="follow-ups" lead="how soon nudges people who go quiet.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="follow-ups by default">
            <Toggle
              checked={prefs.followUpDefaultEnabled}
              disabled={saving}
              onChange={(v) => save({ followUpDefaultEnabled: v })}
              labelOn="on for new conversations"
              labelOff="off unless you turn them on"
            />
          </Field>
          <Field label="cadence">
            <span className="font-mono text-[12px] text-charcoal">
              {prefs.followUpIntervalHours.map((h) => `${Math.round(h / 24)}d`).join(" · ")}
            </span>
          </Field>
          <Field label="quiet hours">
            <span className="text-sm text-body">
              no messages before {prefs.quietHours.earliest} or after {prefs.quietHours.latest}
            </span>
          </Field>
        </div>
      </Section>

      <Section title="automation" lead="the trigger that wakes soon up in imessage.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="trigger emoji">
            <span className="text-2xl">{prefs.triggerEmoji}</span>
            <span className="ml-2 text-xs text-mute">
              react to any message with this to start scheduling
            </span>
          </Field>
          <Field label="timezone">
            <span className="font-mono text-[12px] text-charcoal">{prefs.timezone}</span>
          </Field>
        </div>
      </Section>

      <Section title="privacy" lead="your conversations belong to you.">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => setNotice("session deletion isn't wired up yet")}
          >
            delete a session
          </button>
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => setNotice("style profile reset isn't wired up yet")}
          >
            reset style profile
          </button>
          <button
            type="button"
            className="btn-outline btn-sm text-charcoal"
            onClick={() => setNotice("full deletion isn't wired up yet")}
          >
            delete all my data
          </button>
        </div>
        <p className="mt-2 text-xs text-mute">
          raw message text is only kept briefly for interpretation, then removed.
        </p>
      </Section>

      <Section title="connections" lead="the two things soon needs to work.">
        <div className="inset-group grid gap-px overflow-hidden sm:grid-cols-2">
          <div className="bg-card p-5">
            <h3 className="text-sm font-semibold text-ink">google calendar</h3>
            <p className="mt-1 text-sm text-charcoal">
              {prefs.connections.google.status === "connected" ? (
                <>
                  <span className="badge-success mr-2">connected</span>
                  {prefs.connections.google.email}
                </>
              ) : (
                "not connected"
              )}
            </p>
            <p className="mt-1 text-xs text-mute">
              {prefs.connections.google.lastSyncIso
                ? `last sync ${formatRelative(prefs.connections.google.lastSyncIso)}`
                : "never synced"}
            </p>
            {prefs.connections.google.status !== "connected" && (
              <a href="/api/google/calendar/connect" className="btn-dark btn-sm mt-3">
                connect google calendar
              </a>
            )}
          </div>
          <div className="bg-card p-5">
            <h3 className="text-sm font-semibold text-ink">mac agent</h3>
            <p className="mt-1 text-sm text-charcoal">
              {prefs.connections.mac.status === "active" ? (
                <>
                  <span className="badge-success mr-2">online</span>
                  {prefs.connections.mac.deviceName ?? "your mac"}
                </>
              ) : (
                `${prefs.connections.mac.status.replace("_", " ")}`
              )}
            </p>
            <dl className="mt-1 space-y-0.5 text-xs text-mute">
              <div>
                messages permission: {prefs.connections.mac.messagesPermission.replace("_", " ")}
              </div>
              <div>
                {prefs.connections.mac.lastSeenIso
                  ? `last seen ${formatRelative(prefs.connections.mac.lastSeenIso)}`
                  : "never seen"}
              </div>
              {prefs.connections.mac.appVersion && (
                <div className="font-mono">app version {prefs.connections.mac.appVersion}</div>
              )}
            </dl>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="display text-xl text-ink">{title}</h2>
      <p className="mb-4 mt-1 text-sm text-mute">{lead}</p>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <p className="mb-1.5 text-xs font-semibold text-mute">{label}</p>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  labelOn,
  labelOff,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex cursor-pointer items-center gap-2 text-left"
    >
      <span
        aria-hidden
        className={clsx(
          "relative inline-block h-5 w-9 shrink-0 rounded-full border border-hairline transition-colors",
          checked ? "bg-surface-dark" : "bg-bone",
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-card transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
      <span className="text-sm text-body">{checked ? labelOn : labelOff}</span>
    </button>
  );
}
