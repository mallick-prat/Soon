# runbooks

## google oauth revoked / token refresh fails
symptom: `TokenRefreshError` from `@soon/calendar`; sessions pause with private
"reconnect google calendar" notification. action: user reconnects via dashboard
connections; sessions resume from persisted state; never offer times from stale data.

## google calendar outage
freebusy/event calls fail after bounded retries → sessions needing calendar data move to
`needs_user_input` with a private notification; no drafts referencing availability are
sent. watch the google api error-rate dashboard; recovery is automatic on next action.

## photon provider fails after a macos update
menu-bar state `mac disconnected`; listener restarts with backoff; if the provider cannot
initialize, surface "permission needed" and re-run onboarding checks. pin and
feature-flag photon versions; roll back the mac release if a new os breaks the provider.

## full disk access removed
detected by health check → pause listener, private notification, dashboard connection
warning. no queued sends execute until access is restored and context is re-verified.

## realtime gateway outage
mac queues nothing new (triggers are detected locally and buffered); cloud commands stay
in the outbox as `created`. on recovery, commands past `expiresAt` are marked expired —
never late-sent; the workflow re-plans from current context.

## workflow provider outage
`workflow_runs.last_heartbeat_at` goes stale → alert. sessions keep accurate
`next_action_at` in postgres, so runs can be re-driven after recovery; idempotency keys
make replays safe.

## postgres failover
managed provider handles promotion; workers reconnect via pooled endpoints. verify no
duplicate sends occurred by auditing `outbox_commands` acknowledgements after failover.

## stuck follow-up workflow
find via dashboard "stuck workflow runs" (wake_at in past, no heartbeat). cancel the run,
re-schedule from `follow_up_attempts` state; the per-attempt idempotency key prevents a
double send.

## duplicate calendar event report
reconcile by `soonIdempotencyKey` extended property; delete the newer duplicate with
`sendUpdates: "none"` if attendees haven't interacted; file the reproduction — creation
must always query-before-retry.

## message sent but acknowledgement lost
mac persisted the provider result locally; on reconnect it replays `message_sent` with the
same idempotency key. the cloud treats the replay as the ack — never re-issues the send
command (dedupe by key).

## security incident / key rotation
rotate DEVICE_SIGNING_SECRET and jwt keys (devices re-auth on reconnect); bump
DATA_ENCRYPTION_KEY_VERSION and lazily re-encrypt tokens on next read; revoke google
tokens if scoped to the incident; audit `audit_events` for the window.

## bad mac release
staged channels (internal → beta → stable); rollback = republish previous signed build and
set minimum-supported-version; kill switches: disable autonomous sends remotely by
app version, user, device, conversation, or workflow type.
