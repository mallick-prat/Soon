import { Writable } from "node:stream";
import { signEnvelope } from "@soon/security";
import { createLogger, type Logger } from "@soon/observability";
import { PROTOCOL_VERSION, type CloudCommand, type DeviceEvent } from "@soon/realtime-protocol";
import type { GatewayConfig } from "./config.js";

export const TEST_INTERNAL_TOKEN = "internal-token-for-tests-1234";
export const TEST_SIGNING_SECRET = "device-signing-secret-tests";
export const TEST_JWT_SECRET = "device-jwt-secret-for-tests";

export function testConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    PORT: 0,
    NODE_ENV: "test",
    INTERNAL_API_TOKEN: TEST_INTERNAL_TOKEN,
    DEVICE_SIGNING_SECRET: TEST_SIGNING_SECRET,
    DEVICE_JWT_SECRET: TEST_JWT_SECRET,
    ...overrides,
  };
}

export function silentLogger(): Logger {
  return createLogger({
    name: "test",
    level: "silent",
    destination: new Writable({ write: (_c, _e, cb) => cb() }),
  });
}

let commandCounter = 0;

export function makeCommand(overrides: Partial<Record<string, unknown>> = {}): CloudCommand {
  commandCounter += 1;
  const base: Record<string, unknown> = {
    protocolVersion: PROTOCOL_VERSION,
    type: "ping",
    commandId: `cmd-${commandCounter}`,
    deviceId: "device-1",
    sequenceNumber: commandCounter,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: `idem-cmd-${commandCounter}`,
    payload: {},
    ...overrides,
  };
  if (!("signature" in overrides)) {
    base["signature"] = signEnvelope(base, TEST_SIGNING_SECRET);
  }
  return base as unknown as CloudCommand;
}

let eventCounter = 0;

export function makeDeviceEvent(overrides: Partial<Record<string, unknown>> = {}): DeviceEvent {
  eventCounter += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "health",
    eventId: `evt-${eventCounter}`,
    deviceId: "device-1",
    sequenceNumber: eventCounter,
    occurredAt: new Date().toISOString(),
    idempotencyKey: `idem-evt-${eventCounter}`,
    payload: { appVersion: "1.0.0", messagesPermission: "ok" },
    ...overrides,
  } as unknown as DeviceEvent;
}
