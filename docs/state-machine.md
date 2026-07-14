# scheduling state machine

states and transitions are defined in `packages/scheduling-engine/src/state-machine.ts`
and persisted on `scheduling_sessions.state`. every transition is validated by
`transition(from, to)` before any side effect runs and recorded as an audit event.
the llm never chooses a state.

## happy path

```
triggered → understanding_context → finding_initial_slots → drafting_proposal
→ awaiting_user_approval → sending_approved_message → waiting_for_attendee
→ interpreting_response → waiting_for_email → confirming_slot → creating_event
→ drafting_confirmation → awaiting_user_approval → sending_approved_message → scheduled
```

## negotiation loop

`interpreting_response → finding_alternative_slots → drafting_proposal → …` until a slot
is accepted or `NEGOTIATION_LIMITS` is hit (3 proposal rounds, 7 elapsed days, 10 outbound
messages, 3 rejected candidate sets) — then the session pauses privately
("couldn't land this one").

## follow-up loop

```
waiting_for_attendee → scheduling_follow_up → waiting_for_follow_up → follow_up_due
→ drafting_follow_up → awaiting_follow_up_approval → sending_follow_up → waiting_for_attendee
```

a reply at any point in the loop transitions to `interpreting_response` and cancels every
pending follow-up timer (`follow-up-engine.onReplyReceived`). when the configured sequence
ends: `follow_up_sequence_exhausted` — the session stays in upcoming conversations and the
user is privately asked "keep trying with alex?".

## user controls

`paused` is reachable from every live state; `taken_over` returns control to the user while
keeping the session observable. `scheduled` permits `rescheduling` and `cancelling`.
`expired` and `failed` are terminal.
