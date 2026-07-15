import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME, loadRuntimeConfig } from "./config.js";

describe("loadRuntimeConfig", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "soon-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeFile(config: Record<string, unknown>): void {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), JSON.stringify(config));
  }

  it("falls back to production defaults with no env or file", () => {
    const cfg = loadRuntimeConfig({ env: {}, userDataDir: dir });
    expect(cfg.gatewayUrl).toBe("https://gateway.soon.local");
    expect(cfg.dashboardUrl).toBe("https://app.soon.local");
    expect(cfg.useFakeImessage).toBe(false);
    expect(cfg.enrollmentCode).toBeUndefined();
  });

  it("reads localhost + fake imessage from the config file", () => {
    writeFile({
      gatewayUrl: "http://localhost:8787",
      dashboardUrl: "http://localhost:3100",
      useFakeImessage: true,
      enrollmentCode: "abc123",
    });
    const cfg = loadRuntimeConfig({ env: {}, userDataDir: dir });
    expect(cfg.gatewayUrl).toBe("http://localhost:8787");
    expect(cfg.dashboardUrl).toBe("http://localhost:3100");
    expect(cfg.useFakeImessage).toBe(true);
    expect(cfg.enrollmentCode).toBe("abc123");
  });

  it("lets env override the file", () => {
    writeFile({ gatewayUrl: "http://localhost:8787", useFakeImessage: true });
    const cfg = loadRuntimeConfig({
      env: { SOON_GATEWAY_URL: "http://192.168.1.5:8787", SOON_USE_FAKE_IMESSAGE: "0" },
      userDataDir: dir,
    });
    expect(cfg.gatewayUrl).toBe("http://192.168.1.5:8787");
    // env explicitly disables fake even though the file enabled it
    expect(cfg.useFakeImessage).toBe(false);
  });

  it("tolerates a malformed config file", () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILE_NAME), "{ not json");
    const cfg = loadRuntimeConfig({ env: {}, userDataDir: dir });
    expect(cfg.gatewayUrl).toBe("https://gateway.soon.local");
  });
});
