"use client";

import { useState } from "react";
import type { ApprovalDraftView } from "@/lib/types";
import { MEETING_TYPE_LABELS } from "@/lib/copy";
import { formatDayTime, formatRelative, initialOf } from "@/lib/format";
import { useAction } from "@/lib/use-action";

export function ApprovalList({ drafts }: { drafts: ApprovalDraftView[] }) {
  if (drafts.length === 0) {
    return (
      <div className="inset-group px-8 py-16 text-center">
        <p className="text-base text-charcoal">no drafts waiting on you.</p>
        <p className="mt-1 text-sm text-mute">
          when soon writes a message that needs your ok, it shows up here.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {drafts.map((draft) => (
        <DraftCard key={draft.id} draft={draft} />
      ))}
    </ul>
  );
}

function DraftCard({ draft }: { draft: ApprovalDraftView }) {
  const { run, pending, message } = useAction();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.proposedText);
  const act = (body: Record<string, unknown>, label: string) =>
    run(`/api/drafts/${draft.id}/actions`, body, label);
  const sessionAct = (body: Record<string, unknown>, label: string) =>
    run(`/api/sessions/${draft.sessionId}/actions`, body, label);

  return (
    <li className="card-lg p-6">
      <div className="flex items-start gap-4">
        <div
          aria-hidden
          className="display flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bone text-lg text-ink"
        >
          {initialOf(draft.contactName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-base font-semibold text-ink">{draft.contactName}</span>
            <span className="text-sm text-mute">
              {MEETING_TYPE_LABELS[draft.meetingType] ?? draft.meetingType} ·{" "}
              {draft.durationMinutes} min · {draft.objectiveLabel}
            </span>
            <span className="ml-auto text-xs text-ash">
              expires {formatRelative(draft.expiresAtIso)}
            </span>
          </div>
          <p className="mt-1 text-xs text-mute">{draft.contextSummary}</p>

          {editing ? (
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              className="mt-4 w-full rounded-[10px] border border-hairline bg-card p-3 text-sm text-ink focus:outline-none"
              style={{ boxShadow: "none" }}
            />
          ) : (
            <div className="mt-4 rounded-[10px] bg-bone p-4">
              <p className="text-[15px] leading-relaxed text-body">{text}</p>
            </div>
          )}

          {draft.candidateTimes.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {draft.candidateTimes.map((slot) => (
                <span key={slot.id} className="pill font-mono text-[11px]">
                  {formatDayTime(slot.startsAtIso, slot.timezone)}
                </span>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={pending !== null}
              onClick={() =>
                editing
                  ? act({ action: "edit", text }, "send")
                  : act({ action: "approve" }, "send")
              }
            >
              {pending === "send" ? "sending…" : editing ? "send edited" : "send"}
            </button>
            <button
              type="button"
              className="btn-outline btn-sm"
              disabled={pending !== null}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? "keep original" : "edit"}
            </button>
            {draft.alternativeTexts.length > 0 && !editing && (
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => {
                  const pool = [draft.proposedText, ...draft.alternativeTexts];
                  const index = pool.indexOf(text);
                  setText(pool[(index + 1) % pool.length] ?? draft.proposedText);
                }}
              >
                another way to say it
              </button>
            )}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pending !== null}
              onClick={() => act({ action: "regenerate" }, "regenerate")}
            >
              rewrite it
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={pending !== null}
              onClick={() => sessionAct({ action: "take_over" }, "take over")}
            >
              i&apos;ll take it from here
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm text-mute"
              disabled={pending !== null}
              onClick={() => act({ action: "reject" }, "stop")}
            >
              don&apos;t send
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-charcoal">{message}</p>}
        </div>
      </div>
    </li>
  );
}
