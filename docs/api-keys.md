# api keys & external services

soon runs locally with **no external keys** — the dashboard shows demo data, and
`pnpm test` / `pnpm build` need no network or db. add the keys below only when you want
real end-to-end behavior (real calendar, real db, real drafting).

these must be obtained by signing into the respective consoles yourself; they can't be
generated locally. put them in `.env` (gitignored). already-generated local secrets
(`AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `DEVICE_SIGNING_SECRET`, `DEVICE_JWT_SECRET`,
`INTERNAL_API_TOKEN`) are done.

## 1. postgres — `DATABASE_URL`  (needed for real dashboard data + worker)

pick one:
- **local**: `createdb soon` → `DATABASE_URL=postgresql://localhost:5432/soon`
- **neon** (serverless): https://console.neon.tech → new project → copy the pooled
  connection string. (a Neon connector is available in this workspace but must be
  authorized in an interactive session first.)
- **supabase**: https://supabase.com/dashboard → project → settings → database.

then:
```sh
pnpm --filter @soon/database exec prisma migrate dev --schema ../../prisma/schema.prisma
pnpm --filter @soon/database exec tsx ../../prisma/seed.ts   # optional demo data
```

## 2. google oauth — sign-in + calendar

one google cloud project covers both. https://console.cloud.google.com
1. apis & services → enable **Google Calendar API**.
2. oauth consent screen → external → add yourself as a test user.
3. credentials → create **OAuth client ID** → web application.
4. authorized redirect URIs (local):
   - `http://localhost:3000/api/auth/callback/google`  (next-auth sign-in)
   - `http://localhost:3000/api/google/calendar/callback`  (calendar connect)
5. copy the client id/secret into `.env`:

```
AUTH_GOOGLE_ID=...
AUTH_GOOGLE_SECRET=...
GOOGLE_CALENDAR_CLIENT_ID=...            # can reuse the same client
GOOGLE_CALENDAR_CLIENT_SECRET=...
```

request the minimum scopes (freebusy read, event read, event create/update/delete on
soon-created events) per the prd onboarding screen 2.

## 3. llm — drafting (`@soon/agent`)

provider-agnostic; anthropic is the default. https://console.anthropic.com → api keys.
```
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-5          # sonnet is the cost/quality default for drafting
LLM_API_KEY=sk-ant-...
```
(openai also supported: `LLM_PROVIDER=openai`, an `sk-...` key, and an openai model id.)

## 4. trigger.dev — durable follow-up workflows (optional for local)

only needed to run the real worker; tests use the in-memory workflow client.
https://cloud.trigger.dev → project → api keys.
```
TRIGGER_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_REF=proj_...
```

## 5. optional / later

- observability: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `POSTHOG_KEY`.
- realtime gateway already works with the local `DEVICE_JWT_SECRET`; for asymmetric
  device jwts instead, generate an ES256/EdDSA keypair and set `REALTIME_JWT_PUBLIC_KEY`
  (gateway) + private key (mac signer).
- mac release signing (`APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `MACOS_SIGNING_IDENTITY`) — only for notarized distribution, not dev.
