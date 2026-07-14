// inject workspace:* dependencies into workspace package.json files
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const links = {
  "packages/scheduling-engine": ["shared-types"],
  "packages/calendar": ["shared-types"],
  "packages/style-engine": ["shared-types"],
  "packages/approval-engine": ["shared-types"],
  "packages/follow-up-engine": ["shared-types"],
  "packages/agent": ["shared-types", "scheduling-engine", "style-engine"],
  "packages/workflow": ["shared-types"],
  "packages/test-fixtures": ["shared-types"],
  "apps/web": [
    "shared-types",
    "database",
    "scheduling-engine",
    "calendar",
    "approval-engine",
    "follow-up-engine",
    "security",
    "observability",
    "message-copy",
  ],
  "apps/realtime-gateway": ["shared-types", "realtime-protocol", "security", "observability"],
  "apps/worker": [
    "shared-types",
    "database",
    "scheduling-engine",
    "calendar",
    "agent",
    "approval-engine",
    "follow-up-engine",
    "observability",
  ],
  "apps/mac": ["shared-types", "realtime-protocol", "local-database", "message-copy"],
};

for (const [dir, deps] of Object.entries(links)) {
  const path = join(root, dir, "package.json");
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.dependencies ??= {};
  for (const dep of deps) pkg.dependencies[`@soon/${dep}`] = "workspace:*";
  writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  console.log("linked", dir, "->", deps.join(", "));
}
