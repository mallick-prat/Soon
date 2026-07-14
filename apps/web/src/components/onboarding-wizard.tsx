"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";

import { PairDevice } from "@/components/pair-device";

const TOTAL_STEPS = 8;

const MEETING_PRESETS = [
  ["quick call", "15 min"],
  ["catch-up", "30 min"],
  ["coffee", "45 min"],
  ["lunch", "60 min"],
  ["dinner", "90 min"],
];

const STYLE_MODES = [
  { key: "learn", label: "learn from my messages", body: "soon matches how you already text in each conversation.", payload: { mode: "adaptive" as const } },
  { key: "concise", label: "concise", body: "short and to the point.", payload: { mode: "fixed" as const, formality: "concise" } },
  { key: "casual", label: "casual", body: "relaxed and friendly.", payload: { mode: "fixed" as const, formality: "casual" } },
  { key: "professional", label: "professional", body: "polished and formal.", payload: { mode: "fixed" as const, formality: "professional" } },
];

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // collected settings
  const [timezone, setTimezone] = useState(guessTimezone());
  const [minimumNoticeHours, setMinimumNoticeHours] = useState(2);
  const [maxPerDay, setMaxPerDay] = useState(8);
  const [weekend, setWeekend] = useState(false);
  const [video, setVideo] = useState<"meet" | "none">("meet");
  const [styleKey, setStyleKey] = useState("learn");
  const [approvalMode, setApprovalMode] = useState<"approve_every" | "bundle">("approve_every");

  async function save(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 503) {
        setNotice("no database connected — your choices aren't saved in demo mode, but you can keep exploring.");
        return true; // let demo users continue
      }
      if (!res.ok) {
        setNotice("couldn't save that step — try again.");
        return false;
      }
      return true;
    } catch {
      setNotice("network error — try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => {
    setNotice(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  async function saveThen(body: Record<string, unknown>) {
    if (await save(body)) next();
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-8 flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={clsx(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= step ? "bg-primary" : "bg-hairline",
            )}
          />
        ))}
      </div>

      {notice !== null && (
        <p className="mb-5 rounded-card border border-hairline bg-bone px-3 py-2 text-xs text-charcoal">
          {notice}
        </p>
      )}

      {/* 1 — welcome */}
      {step === 0 && (
        <Screen>
          <h1 className="display text-4xl leading-tight text-ink">meetings should schedule themselves.</h1>
          <p className="mt-4 text-base text-body">
            send 📅 in an imessage conversation. soon checks your calendar and writes the next
            message for you.
          </p>
          <Actions>
            <button className="btn-primary" onClick={next}>
              get started
            </button>
          </Actions>
        </Screen>
      )}

      {/* 2 — connect google calendar */}
      {step === 1 && (
        <Screen>
          <StepTitle n={2} title="connect google calendar" />
          <p className="mt-2 text-sm text-body">
            soon checks when you&apos;re free and creates invites after a time is confirmed. it
            requests the minimum scopes — free/busy, event read, and events it creates.
          </p>
          <div className="mt-6">
            <a className="btn-dark" href="/api/google/calendar/connect">
              connect google calendar
            </a>
          </div>
          <Actions onBack={back}>
            <button className="btn-outline" onClick={next}>
              i&apos;ll do this later
            </button>
          </Actions>
        </Screen>
      )}

      {/* 3 — choose calendars */}
      {step === 2 && (
        <Screen>
          <StepTitle n={3} title="choose calendars" />
          <p className="mt-2 text-sm text-body">
            soon creates events on your primary calendar and blocks time against everything you
            select. you can fine-tune which calendars block availability in preferences once
            google is connected.
          </p>
          <div className="inset-group mt-6 p-4 text-sm text-charcoal">
            new events are created on your <span className="font-semibold text-ink">primary</span>{" "}
            calendar by default.
          </div>
          <Actions onBack={back}>
            <button className="btn-primary" onClick={next}>
              continue
            </button>
          </Actions>
        </Screen>
      )}

      {/* 4 — scheduling defaults */}
      {step === 3 && (
        <Screen>
          <StepTitle n={4} title="scheduling defaults" />
          <p className="mt-2 text-sm text-body">how soon offers your time. change any of this later.</p>

          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <Field label="timezone">
              <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
            <Field label="minimum notice (hours)">
              <input
                className="input"
                type="number"
                min={0}
                value={minimumNoticeHours}
                onChange={(e) => setMinimumNoticeHours(Math.max(0, Number(e.target.value)))}
              />
            </Field>
            <Field label="max meetings per day">
              <input
                className="input"
                type="number"
                min={1}
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(Math.max(1, Number(e.target.value)))}
              />
            </Field>
            <Field label="video by default">
              <Segmented
                options={[
                  ["meet", "google meet"],
                  ["none", "no video"],
                ]}
                value={video}
                onChange={(v) => setVideo(v as "meet" | "none")}
              />
            </Field>
          </div>

          <label className="mt-5 flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={weekend} onChange={(e) => setWeekend(e.target.checked)} />
            soon may offer weekend times
          </label>

          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ash">meeting presets</p>
            <div className="flex flex-wrap gap-1.5">
              {MEETING_PRESETS.map(([type, dur]) => (
                <span key={type} className="pill text-xs">
                  {type} · {dur}
                </span>
              ))}
            </div>
          </div>

          <Actions onBack={back}>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() =>
                saveThen({
                  timezone,
                  calendar: {
                    minimumNoticeMinutes: minimumNoticeHours * 60,
                    maximumMeetingsPerDay: maxPerDay,
                    weekendEnabled: weekend,
                    videoDefault: video,
                  },
                })
              }
            >
              {saving ? "saving…" : "continue"}
            </button>
          </Actions>
        </Screen>
      )}

      {/* 5 — communication style */}
      {step === 4 && (
        <Screen>
          <StepTitle n={5} title="communication style" />
          <p className="mt-2 text-sm text-body">
            soon only uses your scheduling messages to learn how you propose and confirm times.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {STYLE_MODES.map((mode) => (
              <button
                key={mode.key}
                onClick={() => setStyleKey(mode.key)}
                className={clsx(
                  "card flex flex-col items-start gap-0.5 p-4 text-left transition-colors",
                  styleKey === mode.key ? "border-hairline-strong" : "hover:bg-bone",
                )}
              >
                <span className="text-sm font-semibold text-ink">{mode.label}</span>
                <span className="text-xs text-mute">{mode.body}</span>
              </button>
            ))}
          </div>
          <Actions onBack={back}>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => {
                const mode = STYLE_MODES.find((m) => m.key === styleKey) ?? STYLE_MODES[0]!;
                void saveThen({ style: mode.payload });
              }}
            >
              {saving ? "saving…" : "continue"}
            </button>
          </Actions>
        </Screen>
      )}

      {/* 6 — approval behavior */}
      {step === 5 && (
        <Screen>
          <StepTitle n={6} title="approval behavior" />
          <p className="mt-2 text-sm text-body">every message from your number is yours to approve.</p>
          <div className="mt-6 flex flex-col gap-2">
            <ChoiceCard
              selected={approvalMode === "approve_every"}
              onClick={() => setApprovalMode("approve_every")}
              title="approve every message"
              body="soon drafts each message and waits for your one-tap approval."
            />
            <ChoiceCard
              selected={approvalMode === "bundle"}
              onClick={() => setApprovalMode("bundle")}
              title="let me approve small bundles"
              body="approve a bounded set of predictable scheduling replies at once. bundles expire after 3 messages or 24 hours."
            />
          </div>
          <Actions onBack={back}>
            <button
              className="btn-primary"
              disabled={saving}
              onClick={() => void saveThen({ approvalMode })}
            >
              {saving ? "saving…" : "continue"}
            </button>
          </Actions>
        </Screen>
      )}

      {/* 7 — enable imessage access */}
      {step === 6 && (
        <Screen>
          <StepTitle n={7} title="enable imessage access" />
          <p className="mt-2 text-sm text-body">
            the mac companion is the only thing that reads and sends imessage. soon only collects
            conversation context after you activate it.
          </p>
          <ol className="mt-5 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-body">
            <li>confirm messages is signed in on your mac</li>
            <li>grant full disk access + automation permissions</li>
            <li>launch soon at login</li>
            <li>pair the mac with the code below</li>
          </ol>
          <div className="mt-6">
            <PairDevice />
          </div>
          <Actions onBack={back}>
            <button className="btn-primary" onClick={next}>
              continue
            </button>
          </Actions>
        </Screen>
      )}

      {/* 8 — test */}
      {step === 7 && (
        <Screen>
          <StepTitle n={8} title="you&apos;re ready" />
          <p className="mt-3 text-base text-body">
            drop 📅 in any conversation when you want soon to take over the scheduling work.
          </p>
          <div className="inset-group mt-6 p-4 text-sm text-charcoal">
            try it: send <span className="font-semibold text-ink">📅</span> to yourself in a test
            conversation.
          </div>
          <Actions onBack={back}>
            <button className="btn-primary" onClick={() => router.push("/upcoming")}>
              go to dashboard
            </button>
          </Actions>
        </Screen>
      )}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col">{children}</div>;
}

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ash">step {n} of 8</p>
      <h1 className="display mt-1 text-3xl text-ink">{title}</h1>
    </div>
  );
}

function Actions({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="mt-8 flex items-center gap-3">
      {onBack && (
        <button className="btn-ghost" onClick={onBack}>
          back
        </button>
      )}
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-ash">{label}</span>
      {children}
    </label>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex rounded-full border border-hairline bg-card p-1">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={clsx(
            "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
            value === key ? "bg-surface-dark text-on-dark" : "text-charcoal hover:text-ink",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ChoiceCard({
  selected,
  onClick,
  title,
  body,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "card flex flex-col items-start gap-0.5 p-4 text-left transition-colors",
        selected ? "border-hairline-strong" : "hover:bg-bone",
      )}
    >
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-xs text-mute">{body}</span>
    </button>
  );
}
