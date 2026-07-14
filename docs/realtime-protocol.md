# realtime protocol

defined in `@soon/realtime-protocol` (zod discriminated unions) and shared verbatim by the
gateway and the mac client. everything on the wire is a versioned envelope.

## envelope

every cloud→mac command carries: `protocolVersion`, `commandId`, `deviceId`, optional
`sessionId`, `sequenceNumber`, `issuedAt`, `expiresAt`, `idempotencyKey`, `type`,
`payload`, `signature` (hmac-sha256 over the canonical payload, base64url).

## commands (cloud → mac)

- `send_message` — conversationReference, text, draftId, approvalSource (explicit|bundle)
- `collect_context` — conversationReference, maxMessages ≤ 20, maxAgeHours ≤ 48
- `show_notification` — title, subtext, ≤3 actions, optional draftId
- `cancel_command` — targetCommandId
- `ping`

## device events (mac → cloud)

`trigger_detected` · `context_collected` · `inbound_message` · `message_sent` ·
`send_failed` · `command_expired` · `approval_decision` · `health`

## lifecycle

`created → dispatched → delivered → accepted → executed → acknowledged` (or
`failed` / `expired`), mirrored in `outbox_commands`. rules:

- reject stale sequence numbers, expired commands, invalid signatures, unknown schemas,
  and commands addressed to another device.
- a command past `expiresAt` is never executed — it is acked as expired and the workflow
  re-plans from current context.
- `message_sent` is emitted only after the local provider result is persisted; socket
  delivery is never treated as message delivery.
- events carry idempotency keys; the gateway dedupes replays (reconnect-safe).
