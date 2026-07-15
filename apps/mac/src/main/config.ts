/**
 * runtime configuration for the packaged companion.
 *
 * a built .app has no shell environment, so the production defaults below would
 * point a locally-run dev build at unreachable hosts. to make a double-clicked
 * build usable against a local stack, config is resolved in priority order:
 *
 *   1. process.env         (SOON_GATEWAY_URL, SOON_DASHBOARD_URL, …) — wins
 *   2. soon.config.json    in the app's userData dir (drop-in, no rebuild)
 *   3. production defaults  (gateway.soon.local / app.soon.local)
 *
 * the JSON file lets a user point the app at localhost and enable the fake
 * imessage provider without touching the environment:
 *
 *   ~/Library/Application Support/soon/soon.config.json
 *   { "gatewayUrl": "http://localhost:8787",
 *     "dashboardUrl": "http://localhost:3100",
 *     "useFakeImessage": true }
 */
import fs from "node:fs";
import path from "node:path";

export interface RuntimeConfig {
  gatewayUrl: string;
  dashboardUrl: string;
  useFakeImessage: boolean;
  enrollmentCode?: string;
  deviceToken?: string;
  globalShortcut?: string;
  logLevel?: string;
}

interface FileConfig {
  gatewayUrl?: string;
  dashboardUrl?: string;
  useFakeImessage?: boolean;
  enrollmentCode?: string;
  deviceToken?: string;
  globalShortcut?: string;
  logLevel?: string;
}

export const CONFIG_FILE_NAME = "soon.config.json";
const PROD_GATEWAY_URL = "https://gateway.soon.local";
const PROD_DASHBOARD_URL = "https://app.soon.local";

export function configFilePath(userDataDir: string): string {
  return path.join(userDataDir, CONFIG_FILE_NAME);
}

function readFileConfig(userDataDir: string): FileConfig {
  try {
    const raw = fs.readFileSync(configFilePath(userDataDir), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as FileConfig) : {};
  } catch {
    // missing or malformed config is not an error — fall back to env + defaults.
    return {};
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  userDataDir: string;
}

/** resolve the effective runtime config from env, the config file, and defaults. */
export function loadRuntimeConfig(options: LoadConfigOptions): RuntimeConfig {
  const env = options.env ?? process.env;
  const file = readFileConfig(options.userDataDir);

  const pick = (envKey: string, fileValue: string | undefined, fallback: string): string => {
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    if (fileValue !== undefined && fileValue !== "") return fileValue;
    return fallback;
  };

  // env explicitly wins for the fake-imessage flag ("1" on, anything else off);
  // only when unset does the file value apply.
  const envFake = env["SOON_USE_FAKE_IMESSAGE"];
  const useFakeImessage = envFake !== undefined ? envFake === "1" : file.useFakeImessage === true;

  const optional = (envKey: string, fileValue: string | undefined): string | undefined => {
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    if (fileValue !== undefined && fileValue !== "") return fileValue;
    return undefined;
  };

  const enrollmentCode = optional("SOON_ENROLLMENT_CODE", file.enrollmentCode);
  const deviceToken = optional("SOON_DEVICE_TOKEN", file.deviceToken);
  const globalShortcut = optional("SOON_GLOBAL_SHORTCUT", file.globalShortcut);
  const logLevel = optional("SOON_LOG_LEVEL", file.logLevel);

  return {
    gatewayUrl: pick("SOON_GATEWAY_URL", file.gatewayUrl, PROD_GATEWAY_URL),
    dashboardUrl: pick("SOON_DASHBOARD_URL", file.dashboardUrl, PROD_DASHBOARD_URL),
    useFakeImessage,
    ...(enrollmentCode !== undefined ? { enrollmentCode } : {}),
    ...(deviceToken !== undefined ? { deviceToken } : {}),
    ...(globalShortcut !== undefined ? { globalShortcut } : {}),
    ...(logLevel !== undefined ? { logLevel } : {}),
  };
}
