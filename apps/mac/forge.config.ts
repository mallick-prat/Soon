import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import type { ForgeConfig } from "@electron-forge/shared-types";

const appleId = process.env["APPLE_ID"];
const appleIdPassword = process.env["APPLE_APP_SPECIFIC_PASSWORD"];
const teamId = process.env["APPLE_TEAM_ID"];
const canNotarize = appleId !== undefined && appleIdPassword !== undefined && teamId !== undefined;

const config: ForgeConfig = {
  packagerConfig: {
    name: "soon",
    executableName: "soon",
    appBundleId: "app.soon.mac",
    asar: true,
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
  rebuildConfig: {},
  makers: [new MakerZIP({}, ["darwin"]), new MakerDMG({ format: "ULFO" }, ["darwin"])],
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
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
