# architecture

soon is a local-first mac companion plus a hosted control plane. the mac app is the only
component that reads from or writes to the user's imessage account. the cloud owns
authentication, calendar access, scheduling state, approvals, durable follow-up workflows,
and encrypted command delivery. the llm is never the system of record.

## topology

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│ mac companion (electron)│◄──ws──►│ realtime gateway (socket.io) │
│  photon local imessage  │        │  device jwt · signed cmds    │
│  local sqlite outbox    │        └──────────────┬───────────────┘
│  approval window        │                       │
└─────────────────────────┘        ┌──────────────▼───────────────┐
                                   │ web control plane (next.js)  │
                                   │  auth.js · dashboard · api   │
                                   ├──────────────────────────────┤
                                   │ postgres (prisma)            │
                                   ├──────────────────────────────┤
                                   │ worker (trigger.dev)         │
                                   │  1 durable run per session   │
                                   ├──────────────────────────────┤
                                   │ google calendar api          │
                                   │ llm provider (ai sdk)        │
                                   └──────────────────────────────┘
```

## package responsibilities

| package | owns |
|---|---|
| `@soon/shared-types` | domain types + zod schemas: states, slots, drafts, bundles, follow-ups, context |
| `@soon/scheduling-engine` | deterministic interval math, candidate generation/scoring/diversity, the session state machine, parameter resolution |
| `@soon/calendar` | the only google calendar surface: freebusy, idempotent event ops, meet links |
| `@soon/agent` | llm interpretation + drafting behind zod, deterministic post-guards |
| `@soon/style-engine` | style feature extraction, draft constraints, edit-diff learning |
| `@soon/approval-engine` | bundle creation, scope evaluation, consumption, expiry |
| `@soon/follow-up-engine` | follow-up scheduling math, quiet hours, pre-send checklist |
| `@soon/realtime-protocol` | versioned signed envelopes for cloud↔mac commands and events |
| `@soon/security` | envelope encryption, device jwts, command hmac signatures |
| `@soon/observability` | redacting pino loggers, correlation helpers |
| `@soon/workflow` | provider-agnostic durable workflow interface (trigger.dev in prod) |
| `@soon/database` | prisma client + typed repositories |
| `@soon/local-database` | mac-side drizzle/sqlite: cursor, receipts, pending actions |
| `@soon/message-copy` | trigger validation, command parsing, default lowercase copy |
| `@soon/test-fixtures` | canonical conversation + calendar fixtures for simulations |

## hard rules

1. availability is computed by `scheduling-engine` interval math — never by an llm.
2. no conversational message leaves the user's identity without explicit approval or a
   valid, session-scoped, expiring approval bundle. the backend enforces bundle scope
   independently of the llm (`approval-engine`).
3. calendar operations reflecting an already-confirmed agreement may run automatically;
   they are idempotent (private extended properties + idempotency keys, query-before-retry).
4. delivery truth comes from the mac provider result persisted locally and acknowledged
   over the socket — an http 200 or socket emit is never proof an imessage was sent.
5. follow-up timers live in durable workflow runs mirrored to `workflow_runs`, never in
   browser timers, in-memory node timers, or the mac app process.
6. unrelated conversations are never uploaded. context is bounded to 20 messages / 48h
   collected only after activation.

## deviations from the spec's package list

- redis (rate limits, socket.io adapter) is deferred until the gateway needs more than one
  instance; the command store is an injectable interface with an in-memory implementation
  and a documented postgres-outbox adapter path.
- the worker's trigger.dev implementation sits behind `@soon/workflow`'s
  `DurableWorkflowClient` interface so tests use a deterministic in-memory clock.
