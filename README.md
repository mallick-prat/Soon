# soon

a personal scheduling utility that lives quietly inside imessage.

drop 📅. get it scheduled.

## how it works

1. you and someone agree to meet in an existing imessage conversation
2. you send a standalone 📅 (or your chosen trigger emoji)
3. soon reads the recent scheduling context, checks your google calendar, and drafts the next message in your own texting style
4. you approve with one tap or ⌘return — soon sends it from the existing conversation
5. soon interprets replies, negotiates times, follows up when the other person goes quiet, collects their email, and creates the google calendar invite once a time is confirmed

the other person just experiences a normal conversation with you. no links, no assistant language, no robots.

## architecture

local-first mac companion + hosted control plane:

- **apps/mac** — electron menu-bar app; the only component that reads or sends imessage (photon local provider), private approval window, local sqlite outbox
- **apps/web** — next.js dashboard: upcoming conversations, approvals, scheduled events, preferences
- **apps/realtime-gateway** — persistent socket.io service: authenticated device connections, signed command envelopes, delivery acknowledgements
- **apps/worker** — trigger.dev durable workflows: one per scheduling session, persisted follow-up timers that survive deploys and mac sleep
- **packages/scheduling-engine** — deterministic availability: interval math, buffers, notice, candidate scoring and diversity. no llm ever computes free time
- **packages/agent** — llm interpretation and drafting behind zod schemas, with deterministic guards (invented times are rejected, an ambiguous "yes" is never a confirmation)
- **packages/approval-engine** — approval bundles: bounded, session-scoped permission to send narrow scheduling messages; enforced by code, not the llm
- **packages/follow-up-engine** — follow-up policy: cadence, quiet hours, weekend rules, exhaustion
- **packages/calendar** — google calendar: freebusy, idempotent event creation, meet links, private soon metadata only

## development

```sh
pnpm install
pnpm build
pnpm test
```

see docs/local-development.md for the full setup, docs/architecture.md for the system design.

## principles

- invisible until needed; private by default
- write, don't overexplain; match the user
- deterministic scheduling; the llm never invents availability
- every conversational message is explicitly approved or inside a narrow, expiring approval bundle
- reversible actions; narrow scope
