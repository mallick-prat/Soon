# threat model

## assets
imessage conversation content · google oauth tokens · the ability to send messages as the
user · the ability to create calendar events · contact data (phones, emails)

## trust boundaries
1. mac ↔ cloud (websocket) — mutual: device jwt auth per connection; every command is a
   versioned envelope with hmac signature, expiry, sequence number, and idempotency key.
   stale sequence, bad signature, unknown schema, or wrong device → rejected and logged.
2. cloud ↔ llm provider — bounded context + normalized availability only; all output
   parsed through zod; deterministic guards reject invented times; llm output never
   authorizes sends or transitions state.
3. cloud ↔ google — minimal scopes; tokens envelope-encrypted at rest; refresh tokens
   never reach the mac or browser.
4. web browser ↔ cloud — auth.js sessions; zod-validated route bodies; no message bodies
   in analytics.

## key threats and mitigations
- **stolen device jwt** → 10-minute expiry; per-device rooms; one active socket per device;
  signatures on commands mean a jwt alone cannot forge sends.
- **replayed send command** → idempotency key dedupe in the local inbox receipts table +
  expiry check before execution.
- **compromised web session tries to exfiltrate messages** → the cloud never stores
  unbounded conversation text; session messages are sanitized, bounded, and expire at 30
  days; no api returns raw local-db content.
- **prompt injection via attendee messages** → attendee text is data: interpretation output
  is schema-bound with deterministic post-guards; drafts are validated against structured
  slots; bundles constrain objectives regardless of parsed content; sensitive/unrelated
  classification pauses automation.
- **runaway automation** → hard bundle caps (3 msgs/24h), negotiation limits, follow-up
  spacing in days with quiet hours, opt-out stops everything, remote kill switches.
- **supply chain** → pinned lockfile, renovate + codeql + dependency review, electron fuses,
  asar integrity, signed + notarized releases, photon versions behind contract tests.

## non-goals for v1
multi-user isolation (single user), managed cloud imessage lines, e2e encryption of cloud
state beyond token/message-payload envelope encryption.
