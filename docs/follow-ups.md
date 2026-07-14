# follow-ups

soon persists the commitment and keeps working until a terminal condition — it never
silently drops a conversation because a timer fired its last attempt.

## default policy (`DEFAULT_FOLLOW_UP_POLICY`)

- first follow-up 48h after the original proposal; second at 5 days; third at 10 days
- quiet hours 09:00–19:00 in the contact's likely local timezone
- weekends off by default; deferred sends land monday 09:00
- max 3 automatic attempts (user-configurable 1–5); session review at 30 days

## durability

timers are durable workflow waits (trigger.dev in production, mirrored into
`workflow_runs` / `follow_up_attempts`), never in-memory. every attempt has a unique
idempotency key; delivery is acknowledged by the mac before another attempt may be
scheduled; a per-session send lock prevents concurrent sends.

## pre-send checklist

`evaluatePreSendChecklist` blocks the send when: the session is no longer active, a new
inbound message arrived, the user replied manually, the bundle became invalid, the moment
is outside allowed hours, the attendee declined or opted out, referenced candidate times
went stale (replacements outside the bundle require new approval), or the conversation
already moved on.

## on reply

all pending timers cancel immediately (`onReplyReceived`), the reply is interpreted, and a
new timer is created only after the next outbound proposal returns the session to
`waiting_for_attendee`.

## terminal conditions

scheduled · clear decline · user pause/cancel/stop/takeover · marked resolved elsewhere ·
sensitive/out-of-scope shift · policy exhausted without extension · contact opt-out
(opt-out stops everything immediately and permanently for that contact).
