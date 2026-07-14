# privacy

## collection boundaries

- no conversation context is collected before activation. the local listener inspects only
  the metadata needed to detect a user-authored trigger.
- after activation, context is bounded: 20 messages / 48 hours, from the activated
  conversation only. unrelated conversations are never uploaded or analyzed.
- style learning reads user-authored messages only, restricted to scheduling messages;
  style examples are stripped of unrelated personal content before any llm call.
- the llm receives normalized availability (structured slots), never full calendar contents.

## storage

- google tokens encrypted at rest with versioned envelope encryption (`@soon/security`).
- mac device credentials live in the macos keychain (electron `safeStorage`).
- raw session message text expires after 30 days by default; structured metadata remains.
- logs and analytics never contain message bodies, phone numbers, emails, or tokens —
  `@soon/observability` redacts by path; identities appear as short hashes.

## user rights

- delete all data; delete a single session immediately; reset the style profile.
- audit log of every automatically sent message, with explicit-vs-bundle approval source.
- conversation data is never used for model training.

## sensitive conversations

when context appears sensitive: minimized upload, generic event title
("meeting with {first name}"), bundles disabled, every message explicitly approved, no
sensitive purpose text in any calendar field.
