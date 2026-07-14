# local development

## prerequisites

- node ≥ 20, pnpm 10 (`corepack enable`)
- postgres (local or neon/supabase dev project) for the web app and worker
- a google cloud oauth client (calendar scopes) for end-to-end calendar testing
- macos with messages signed in, for the mac companion

## setup

```sh
pnpm install
cp .env.example .env      # fill DATABASE_URL, google + llm keys as needed
pnpm build                # turbo builds every package in dependency order
pnpm test                 # full test suite — no network, no db required
```

## per-surface

- **web**: `pnpm --filter @soon/web dev` (http://localhost:3000). db-backed pages render
  empty states without DATABASE_URL.
- **gateway**: `pnpm --filter @soon/realtime-gateway dev` (port 8787). needs
  DEVICE_SIGNING_SECRET + INTERNAL_API_TOKEN; generates a dev jwt keypair if unset.
- **mac**: `pnpm --filter @soon/mac start` runs electron forge in dev mode. unit tests
  never require electron; provider integration is behind a feature flag so you can develop
  against the `FakeProvider` message feed.
- **worker**: trigger.dev dev mode once TRIGGER_SECRET_KEY is set; workflows are also fully
  exercisable via `@soon/workflow`'s in-memory client in tests.
- **prisma**: `pnpm --filter @soon/database exec prisma migrate dev` against your local db;
  `prisma/seed.ts` seeds a demo user and sessions in varied states.

## conventions

- strict typescript everywhere (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- esm with explicit `.js` import suffixes in packages.
- tests colocated as `src/**/*.test.ts`, excluded from builds.
- all user-facing copy lowercase.
- no new dependencies without an owner and purpose (see the package acceptance policy in
  the prd); run `pnpm test` and `pnpm build` before committing.
