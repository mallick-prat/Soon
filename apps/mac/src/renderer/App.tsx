import { useEffect, useState } from "react";

import type { ApprovalDecisionKind, ApprovalRequest, BundleStatus } from "../approvals/types.js";

const bundleLine = (status: BundleStatus): string => {
  switch (status.mode) {
    case "approve_every":
      return "approving each message individually";
    case "bundle":
      return `bundle: ${status.messagesUsed}/${status.maximumOutboundMessages} messages used`;
    case "calendar_only":
      return "calendar-only mode";
  }
};

export const App = (): React.JSX.Element => {
  const [payload, setPayload] = useState<ApprovalRequest | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState("");

  useEffect(() => {
    void window.soon.getApprovalPayload().then((p) => {
      if (p !== undefined) {
        setPayload(p);
        setEditedText(p.proposedText);
      }
    });
    return window.soon.onPayload((p) => {
      setPayload(p);
      setEditedText(p.proposedText);
      setEditing(false);
    });
  }, []);

  if (payload === undefined) {
    return (
      <div className="approval">
        <p className="approval__empty">nothing waiting for review</p>
      </div>
    );
  }

  const decide = (decision: ApprovalDecisionKind): void => {
    if (decision === "edit" || (decision === "send" && editing && editedText !== payload.proposedText)) {
      window.soon.decide({ draftId: payload.draftId, decision: "edit", editedText });
      return;
    }
    window.soon.decide({ draftId: payload.draftId, decision });
  };

  return (
    <div className="approval">
      <div>
        <p className="approval__eyebrow">soon wants to send</p>
        <p className="approval__context">{payload.meetingContext}</p>
      </div>

      {editing ? (
        <textarea
          className="approval__edit"
          value={editedText}
          autoFocus
          onChange={(e) => setEditedText(e.target.value)}
        />
      ) : (
        <div className="approval__message">{payload.proposedText}</div>
      )}

      {payload.candidateTimes.length > 0 && (
        <div>
          <p className="approval__section-label">candidate times</p>
          <div className="approval__times">
            {payload.candidateTimes.map((t) => (
              <span key={t.slotId} className="time-chip">
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {payload.whySelected !== "" && <p className="approval__why">{payload.whySelected}</p>}

      <hr className="approval__divider" />
      <p className="approval__bundle">{bundleLine(payload.bundleStatus)}</p>

      <div className="approval__actions">
        <button type="button" className="btn btn--primary" onClick={() => decide("send")}>
          send
        </button>
        <div className="approval__actions-row">
          <button type="button" className="btn" onClick={() => setEditing((v) => !v)}>
            {editing ? "keep original" : "edit"}
          </button>
          <button type="button" className="btn" onClick={() => decide("another")}>
            another time
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => decide("take_over")}>
            take over
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => decide("stop")}>
            stop
          </button>
        </div>
        <p className="approval__hint">⌘return to send while this window is focused</p>
      </div>
    </div>
  );
};
