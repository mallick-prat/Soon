# macos permissions

the mac companion needs, in onboarding order:

1. **messages signed in** — the app uses the messages account already on the mac
   (photon local provider). verify via a provider health check.
2. **full disk access** — required for the local messages store. onboarding deep-links to
   system settings → privacy & security → full disk access, then re-checks.
3. **automation** — sending messages via the local provider prompts for messages
   automation consent on first send; the onboarding test trigger exercises this early.
4. **notifications** — private approval notifications with actions (review / stop).
5. **login item** — `app.setLoginItemSettings({ openAtLogin: true })`, toggleable.

## failure handling

- full disk access revoked → menu-bar state `permission needed`, listener paused, private
  notification; never fail silently.
- automation denied → outbound sends fail with a typed error surfaced in the approval
  window; drafts stay queued with expiry.
- permission checks re-run on wake, on reconnect, and before every queued send.

## what the listener may and may not do

- may: detect new user-authored trigger messages; read bounded context after activation;
  send explicitly approved or bundle-authorized messages.
- may not: upload unrelated conversation text; collect context before activation; send
  anything into the conversation that was not approved.
