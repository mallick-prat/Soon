#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

# external deps
pnpm --filter @soon/shared-types add zod
pnpm --filter @soon/scheduling-engine add date-fns date-fns-tz
pnpm --filter @soon/calendar add googleapis google-auth-library zod
pnpm --filter @soon/style-engine add zod
pnpm --filter @soon/approval-engine add zod date-fns
pnpm --filter @soon/follow-up-engine add date-fns date-fns-tz zod
pnpm --filter @soon/agent add ai @ai-sdk/openai @ai-sdk/anthropic zod chrono-node date-fns date-fns-tz
pnpm --filter @soon/workflow add zod
pnpm --filter @soon/realtime-protocol add zod jose
pnpm --filter @soon/message-copy add zod emoji-regex grapheme-splitter
pnpm --filter @soon/security add jose zod
pnpm --filter @soon/observability add pino
pnpm --filter @soon/observability add -D pino-pretty
pnpm --filter @soon/database add @prisma/client @prisma/adapter-pg pg
pnpm --filter @soon/database add -D prisma @types/pg
pnpm --filter @soon/local-database add drizzle-orm better-sqlite3
pnpm --filter @soon/local-database add -D drizzle-kit @types/better-sqlite3

pnpm --filter @soon/web add next react react-dom next-auth@beta googleapis google-auth-library zod @tanstack/react-query clsx lucide-react
pnpm --filter @soon/web add -D @types/react @types/react-dom tailwindcss @tailwindcss/postcss postcss

pnpm --filter @soon/realtime-gateway add socket.io fastify @fastify/helmet @fastify/cors zod jose pino

pnpm --filter @soon/worker add @trigger.dev/sdk zod chrono-node date-fns date-fns-tz neverthrow pino

pnpm --filter @soon/mac add spectrum-ts @spectrum-ts/imessage-local better-sqlite3 drizzle-orm socket.io-client zod emoji-regex grapheme-splitter pino p-retry p-timeout serialize-error
pnpm --filter @soon/mac add -D electron @electron-forge/cli @electron-forge/maker-dmg @electron-forge/maker-zip @electron-forge/plugin-vite @electron-forge/plugin-fuses @electron/notarize vite @vitejs/plugin-react react react-dom @types/react @types/react-dom @types/better-sqlite3 drizzle-kit

# workspace deps
node scripts/link-workspace-deps.mjs

pnpm install

echo "INSTALL COMPLETE"
