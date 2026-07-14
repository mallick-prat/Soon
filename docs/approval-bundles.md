# approval bundles

a bundle is a bounded, session-scoped grant to send a narrow set of predictable scheduling
messages without per-message approval. enforcement lives in `@soon/approval-engine` and runs
in the backend — the llm's opinion about whether something is allowed is irrelevant.

## invariants

- one session only. bundles never apply across conversations.
- hard caps regardless of what the user asked for: **3 outbound messages, 24 hours**
  (`BUNDLE_DEFAULTS`), and earlier on event creation, session cancellation, or takeover.
- explicit scope recorded at creation: allowed objectives, approved slot ids, date range,
  duration range, participant set.
- every bundle-authorized send is recorded in the audit log with `approval_source: bundle`,
  distinguishable from explicit approvals.

## boundaries that pause automation

evaluated by `evaluateDraftAgainstBundle` before every send:

- objective not in the allowed set; slots outside the approved set; dates outside range;
  duration outside range; a new attendee; expired or consumed bundle
- parsed-message signals: purpose change, personal/unrelated question, confusion,
  sensitive content, new commitment, location requiring judgment, paid activity,
  anything flagged `requiresUserJudgment`
- draft confidence below `CONFIDENCE_REVIEW_THRESHOLD`
- sensitive sessions disable bundles entirely

on a boundary the session moves to `awaiting_user_approval` and the user is notified
privately with the reason.
