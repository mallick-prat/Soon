# CLAUDE.md — soon

a personal scheduling utility that lives quietly inside imessage. the source of
truth for product behavior is the prd; this file is the working guide for the code.

## commands

run from the repo root (turbo fans out across the workspace):

```sh
pnpm install          # install everything (lockfile is committed)
pnpm build            # turbo build, dependency-ordered
pnpm test             # full vitest suite — no network, no db required
pnpm typecheck        # tsc --noEmit everywhere
pnpm lint             # turbo lint
pnpm dev              # run dev servers
```

single package: `pnpm --filter @soon/<name> <script>` (e.g. `pnpm --filter @soon/web dev`).

per-surface dev:
- web dashboard: `pnpm --filter @soon/web dev` → http://localhost:3000 (renders demo
  data without `DATABASE_URL`).
- realtime gateway: `pnpm --filter @soon/realtime-gateway dev` → :8787.
- worker: trigger.dev dev mode once `TRIGGER_SECRET_KEY` is set; also exercisable via
  `@soon/workflow`'s in-memory client in tests.
- mac app: `pnpm --filter @soon/mac start` (electron forge). unit tests never need
  electron; imessage is behind a feature flag with a `FakeProvider` for local dev.

## toolchain — non-obvious pins (do not "upgrade" without reading this)

- **node ≥ 20, pnpm 10.17** (`packageManager` pins it; use `corepack enable`).
- **typescript is pinned to `^6.0.3`, NOT `^7`.** typescript 7 is the native (go) port
  and deliberately omits `typescript/lib/typescript.js`, the classic JS API that
  next.js 16 loads for its build — with 7.x, `next build` tries to auto-install
  typescript and crashes (`ERR_PACKAGE_PATH_NOT_EXPORTED`). 6.x also satisfies the
  `spectrum-ts` peer range (`^5 || ^6`). the pins live in root `package.json` and
  `apps/web/package.json`.
- **prisma client is generated as typescript** into `packages/database/src/generated/prisma`
  from the root schema. it is committed, but to regenerate:
  `pnpm --filter @soon/database exec prisma generate --schema ../../prisma/schema.prisma`.
  the generator uses the new `prisma-client` provider (esm, `.ts` output).
- **tailwind v4**: shared component base classes that are composed with `@apply` (e.g.
  `.btn`) must be declared with `@utility`, not inside `@layer components` — v4 `@apply`
  only resolves utilities, not other component classes. see `apps/web/src/app/globals.css`.
- native deps (`better-sqlite3`, `esbuild`, `electron`) build fine; pnpm 10 sandboxes
  install scripts, so `sharp`/`prisma` scripts show as "ignored" — expected, not a bug.
  `electron` is listed in root `pnpm.onlyBuiltDependencies` so its postinstall runs and
  actually downloads the Electron binary (without it, packaging fails with no `dist/`).
- **`node-linker=hoisted` (root `.npmrc`) is required and intentional.** electron-forge's
  packager cannot traverse pnpm's default isolated (symlinked) `node_modules`, so the mac
  app won't package without it. it changes only the on-disk layout, not the committed
  lockfile. do not remove it.

## packaging the mac app (electron)

```sh
pnpm --filter @soon/mac package   # → apps/mac/out/soon-darwin-arm64/soon.app (clickable)
pnpm --filter @soon/mac make      # → out/make/zip/darwin/arm64/soon-darwin-arm64-<v>.zip
                                  #   + out/make/dmg/arm64/soon-<v>-arm64.dmg
```

non-obvious bits (all in `apps/mac/forge.config.ts`):

- **electron is pinned to `^37`, NOT latest.** the local outbox uses `better-sqlite3`
  (a native addon), and better-sqlite3 ships prebuilt binaries only through electron 37.
  the `packageAfterCopy` hook fetches that prebuilt via `prebuild-install` for electron's
  ABI, so **no local Xcode/node-gyp toolchain is needed**. bumping electron past 37 means
  either waiting for better-sqlite3 to publish newer prebuilds, or fixing local node-gyp
  (this machine's Command Line Tools have no package receipt, so gyp cannot detect a
  compiler — `pkgutil --pkg-info=com.apple.pkg.CLTools_Executables` returns "No receipt";
  reinstall the CLT to fix).
- the `@electron-forge/plugin-vite` bundles the main process and **excludes all
  `node_modules`**, so native externals declared in `vite.main.config.ts`
  (`better-sqlite3`, `bindings`, `file-uri-to-path`) are copied into the app and unpacked
  from the asar (`asar.unpack: "**/*.node"`) by the same hook.
- the **DMG is built by a custom `hdiutil`-backed maker** (`MakerHdiutilDmg` in
  forge.config.ts), not the stock `MakerDMG` — the stock one pulls in `macos-alias`/
  `fs-xattr`, native addons that must be compiled locally. `hdiutil` ships with macOS,
  so both distributables (ZIP + DMG with a drag-to-/Applications layout) need no
  compiler at all.
- the asar-integrity fuse is disabled for unsigned local builds (incompatible with unpacked
  native addons); a signed release can re-enable it. notarization stays gated behind
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.

**running a packaged dev build against localhost:** a built `.app` has no shell env, so it
reads `~/Library/Application Support/soon/soon.config.json` (see `apps/mac/src/main/config.ts`)
— drop in `{ "gatewayUrl": "http://localhost:8787", "dashboardUrl": "http://localhost:3100",
"useFakeImessage": true }` and it points at the local stack and pairs from the dashboard.
env vars (`SOON_GATEWAY_URL`, `SOON_USE_FAKE_IMESSAGE`, …) still override the file.

## architecture

local-first mac companion + hosted control plane. the mac app is the ONLY component that
touches imessage; the backend never sees the local Messages db.

- `apps/mac` — electron menu-bar app: photon local imessage provider, private approval
  window, local sqlite outbox, signed socket connection to the gateway.
- `apps/web` — next.js (app router) dashboard: upcoming / approvals / scheduled /
  preferences, google oauth, api routes.
- `apps/realtime-gateway` — fastify + socket.io: authenticated device connections, signed
  command envelopes, delivery acks.
- `apps/worker` — trigger.dev durable workflows: one per scheduling session; follow-up
  timers that survive deploys and mac sleep.
- `packages/scheduling-engine` — deterministic availability (interval math, buffers,
  notice, candidate scoring/diversity). **no llm ever computes free time.**
- `packages/agent` — llm interpretation + drafting behind zod schemas, with deterministic
  guards (invented times rejected; an ambiguous "yes" is never a confirmation).
- `packages/approval-engine` — approval bundles: bounded, session-scoped, expiring
  permission to send narrow scheduling messages; enforced in code, not by the llm.
- `packages/follow-up-engine` — cadence, quiet hours, weekend rules, exhaustion.
- `packages/calendar` — google calendar: freebusy, idempotent event creation, meet links,
  private soon-only metadata (never assistant/ai language in attendee-visible fields).
- `packages/database` — prisma (postgres) system of record.
- `packages/local-database` — drizzle + better-sqlite3 for the mac app.
- other packages: `shared-types`, `message-copy`, `style-engine`, `realtime-protocol`,
  `security`, `observability`, `workflow`, `test-fixtures`.

## conventions

- strict typescript (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- esm with explicit `.js` import suffixes in packages.
- tests colocated as `src/**/*.test.ts`, excluded from builds.
- **all user-facing copy is lowercase** unless the user's own texting style differs.
- scheduling is deterministic; the llm drafts words, never availability.
- every conversational message is explicitly approved or inside a narrow, expiring bundle.
- no new dependencies without an owner + purpose; run `pnpm test` and `pnpm build` before
  committing.

## env / secrets

- copy `.env.example` → `.env`. `.env` is gitignored (never commit it).
- crypto/local secrets (`TOKEN_ENCRYPTION_KEY`, `DEVICE_SIGNING_SECRET`, etc.) can be
  generated locally. external keys (`DATABASE_URL`, `GOOGLE_*`, `LLM_API_KEY`,
  `TRIGGER_*`) come from their consoles — see `docs/local-development.md`.
- tests and builds need no network or db.

## docs

`docs/architecture.md`, `docs/state-machine.md`, `docs/approval-bundles.md`,
`docs/follow-ups.md`, `docs/realtime-protocol.md`, `docs/privacy.md`,
`docs/threat-model.md`, `docs/permissions.md`, `docs/runbooks.md`,
`docs/local-development.md`. design system: `DESIGN.md`.
