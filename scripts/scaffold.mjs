// one-time scaffold generator: package.json + tsconfig + src stub per workspace
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

const libs = [
  "shared-types",
  "scheduling-engine",
  "calendar",
  "agent",
  "style-engine",
  "approval-engine",
  "follow-up-engine",
  "workflow",
  "realtime-protocol",
  "message-copy",
  "security",
  "observability",
  "test-fixtures",
  "database",
  "local-database",
];

const libPkg = (name) => ({
  name: `@soon/${name}`,
  version: "0.1.0",
  private: true,
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
  scripts: {
    build: "tsc -p tsconfig.json",
    test: "vitest run --passWithNoTests",
    typecheck: "tsc --noEmit -p tsconfig.json",
  },
  dependencies: {},
  devDependencies: {},
});

const libTsconfig = {
  extends: "../../tsconfig.base.json",
  compilerOptions: { outDir: "dist", rootDir: "src" },
  include: ["src"],
};

for (const name of libs) {
  const dir = join(root, "packages", name);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(libPkg(name), null, 2) + "\n");
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(libTsconfig, null, 2) + "\n");
  const stub = join(dir, "src", "index.ts");
  if (!existsSync(stub)) writeFileSync(stub, "export {};\n");
}

// apps get bare package.json; each app owns its own build tooling
const apps = {
  web: { name: "@soon/web", scripts: { build: "next build", dev: "next dev", typecheck: "tsc --noEmit", test: "vitest run --passWithNoTests" } },
  mac: { name: "@soon/mac", scripts: { build: "tsc -p tsconfig.json", typecheck: "tsc --noEmit -p tsconfig.json", test: "vitest run --passWithNoTests" } },
  "realtime-gateway": { name: "@soon/realtime-gateway", scripts: { build: "tsc -p tsconfig.json", typecheck: "tsc --noEmit -p tsconfig.json", test: "vitest run --passWithNoTests", dev: "tsx watch src/index.ts" } },
  worker: { name: "@soon/worker", scripts: { build: "tsc -p tsconfig.json", typecheck: "tsc --noEmit -p tsconfig.json", test: "vitest run --passWithNoTests" } },
};

for (const [dirName, extra] of Object.entries(apps)) {
  const dir = join(root, "apps", dirName);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      { name: extra.name, version: "0.1.0", private: true, type: "module", scripts: extra.scripts, dependencies: {}, devDependencies: {} },
      null,
      2,
    ) + "\n",
  );
  if (dirName !== "web") {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(libTsconfig, null, 2) + "\n");
    const stub = join(dir, "src", "index.ts");
    if (!existsSync(stub)) writeFileSync(stub, "export {};\n");
  }
}

console.log("scaffolded", libs.length, "packages and", Object.keys(apps).length, "apps");
