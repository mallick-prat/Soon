import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MakerBase, type MakerOptions } from "@electron-forge/maker-base";
import type { ForgePlatform } from "@electron-forge/shared-types";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

const appleId = process.env["APPLE_ID"];
const appleIdPassword = process.env["APPLE_APP_SPECIFIC_PASSWORD"];
const teamId = process.env["APPLE_TEAM_ID"];
const canNotarize = appleId !== undefined && appleIdPassword !== undefined && teamId !== undefined;

// the vite plugin excludes node_modules from the package (it bundles the main
// process instead), so native addons declared `external` in vite.main.config.ts
// are absent at runtime. these are copied into the packaged app by the
// packageAfterCopy hook below. better-sqlite3 backs the local outbox and is
// required on every boot; bindings + file-uri-to-path are its runtime resolver.
const NATIVE_RUNTIME_MODULES = ["better-sqlite3", "bindings", "file-uri-to-path"];

/** resolve a module's real directory across the hoisted node_modules roots. */
function resolveModuleDir(moduleName: string): string {
  const roots = [
    path.join(import.meta.dirname, "node_modules"),
    path.join(import.meta.dirname, "..", "..", "node_modules"),
  ];
  for (const root of roots) {
    const candidate = path.join(root, moduleName);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`native module ${moduleName} not found in node_modules — run pnpm install`);
}

function bundleNativeModules(buildPath: string, electronVersion: string, arch: string): void {
  for (const moduleName of NATIVE_RUNTIME_MODULES) {
    const src = resolveModuleDir(moduleName);
    const dest = path.join(buildPath, "node_modules", moduleName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // dereference so pnpm's symlinks become real files inside the .app.
    fs.cpSync(src, dest, { recursive: true, dereference: true });
  }
  // fetch better-sqlite3's prebuilt binary for electron's ABI instead of
  // compiling from source — no local Xcode/node-gyp toolchain required. the
  // copied (node-ABI) binary is replaced in place.
  const bsDir = path.join(buildPath, "node_modules", "better-sqlite3");
  const prebuildInstall = path.join(resolveModuleDir("prebuild-install"), "bin.js");
  const result = spawnSync(
    process.execPath,
    [
      prebuildInstall,
      "--runtime=electron",
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      "--platform=darwin",
    ],
    { cwd: bsDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(
      `prebuild-install failed for better-sqlite3 (electron ${electronVersion} ${arch}); ` +
        `no matching prebuilt binary — pin electron to a version better-sqlite3 ships prebuilds for`,
    );
  }
}

/**
 * DMG maker backed by macOS's own `hdiutil` — no native npm addons. the stock
 * MakerDMG pulls in macos-alias/fs-xattr, which must be compiled locally and
 * this machine has no working node-gyp toolchain (CLT receipt missing). the
 * volume gets the classic drag-to-install layout: soon.app + /Applications link.
 */
class MakerHdiutilDmg extends MakerBase<Record<string, never>> {
  name = "hdiutil-dmg";
  defaultPlatforms: ForgePlatform[] = ["darwin"];

  isSupportedOnCurrentPlatform(): boolean {
    return process.platform === "darwin";
  }

  async make(opts: MakerOptions): Promise<string[]> {
    const { dir, makeDir, appName, packageJSON, targetArch } = opts;
    const version = (packageJSON as { version: string }).version;
    const outPath = path.resolve(makeDir, "dmg", targetArch, `${appName}-${version}-${targetArch}.dmg`);
    await this.ensureFile(outPath);

    // stage: <tmp>/soon.app + a symlink to /Applications for drag-to-install.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "soon-dmg-"));
    try {
      fs.cpSync(path.join(dir, `${appName}.app`), path.join(staging, `${appName}.app`), {
        recursive: true,
        verbatimSymlinks: true,
      });
      fs.symlinkSync("/Applications", path.join(staging, "Applications"));

      const result = spawnSync(
        "hdiutil",
        ["create", "-volname", appName, "-srcfolder", staging, "-ov", "-format", "UDZO", outPath],
        { stdio: "inherit" },
      );
      if (result.status !== 0) {
        throw new Error(`hdiutil create failed with exit code ${result.status ?? "unknown"}`);
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    return [outPath];
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    name: "soon",
    executableName: "soon",
    appBundleId: "app.soon.mac",
    // unpack native addons so they load from disk — a .node cannot be required
    // from inside the asar archive.
    asar: { unpack: "**/*.node" },
    appCategoryType: "public.app-category.productivity",
    extendInfo: {
      // menu-bar only: no dock icon.
      LSUIElement: true,
    },
    ...(canNotarize
      ? {
          osxSign: {},
          osxNotarize: {
            appleId,
            appleIdPassword,
            teamId,
          },
        }
      : {}),
  },
  // native modules are handled by the packageAfterCopy hook via prebuilt
  // binaries; disable forge's own node-gyp rebuild so it never runs.
  rebuildConfig: { onlyModules: [] },
  // both distributables need no native npm tooling: ZIP via maker-zip, DMG via
  // the hdiutil-backed maker above (the stock MakerDMG needs a local compiler).
  makers: [new MakerZIP({}, ["darwin"]), new MakerHdiutilDmg()],
  hooks: {
    // runs after @electron/packager copies the app but before asar packaging.
    packageAfterCopy: async (_forgeConfig, buildPath, electronVersion, _platform, arch) => {
      bundleNativeModules(buildPath, electronVersion, arch);
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: "src/main/index.ts", config: "vite.main.config.ts", target: "main" },
        { entry: "src/main/preload.ts", config: "vite.preload.config.ts", target: "preload" },
      ],
      renderer: [{ name: "approval_window", config: "vite.renderer.config.ts" }],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // asar integrity validation is incompatible with unpacked native addons
      // in an unsigned local build; disable it here (signed release builds can
      // re-enable it once the toolchain stamps the integrity header).
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
