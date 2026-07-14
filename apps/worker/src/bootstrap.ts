/**
 * worker transport bootstrap.
 *
 * wires the production CommandDispatcher (outbox-backed) and runs the outbox
 * drainer loop that relays commands to the gateway. this is the transport
 * half of the worker; the scheduling composition root (prisma SessionStore,
 * calendar-backed availability, @soon/agent interpreter) is a separate slice
 * still to be built — see the build-state notes.
 */
import type { Logger } from "@soon/observability";

import { createGatewayDispatcher } from "./adapters/gateway-dispatcher.js";
import { createOutboxDrainer, type OutboxDrainerConfig } from "./adapters/outbox-drainer.js";
import type { CommandDispatcher } from "./ports.js";

/** the production CommandDispatcher — persists commands to outbox_commands. */
export function createProductionDispatcher(): CommandDispatcher {
  return createGatewayDispatcher();
}

export interface DrainerEnv {
  SOON_GATEWAY_URL?: string | undefined;
  GATEWAY_URL?: string | undefined;
  INTERNAL_API_TOKEN?: string | undefined;
  DEVICE_SIGNING_SECRET?: string | undefined;
  OUTBOX_DRAIN_BATCH_SIZE?: string | undefined;
}

/**
 * build the drainer config from environment, failing loudly (naming variables,
 * never values) when a required secret is missing.
 */
export function loadDrainerConfigFromEnv(
  env: DrainerEnv = process.env,
  logger?: Logger,
): OutboxDrainerConfig {
  const gatewayUrl = env.SOON_GATEWAY_URL ?? env.GATEWAY_URL;
  const internalToken = env.INTERNAL_API_TOKEN;
  const signingSecret = env.DEVICE_SIGNING_SECRET;

  const missing = [
    gatewayUrl ? null : "SOON_GATEWAY_URL",
    internalToken ? null : "INTERNAL_API_TOKEN",
    signingSecret ? null : "DEVICE_SIGNING_SECRET",
  ].filter((v): v is string => v !== null);
  if (missing.length > 0) {
    throw new Error(`outbox drainer misconfigured: missing ${missing.join(", ")}`);
  }

  const batch = env.OUTBOX_DRAIN_BATCH_SIZE ? Number(env.OUTBOX_DRAIN_BATCH_SIZE) : undefined;
  return {
    gatewayUrl: gatewayUrl as string,
    internalToken: internalToken as string,
    signingSecret: signingSecret as string,
    ...(batch !== undefined && Number.isFinite(batch) && batch > 0 ? { batchSize: batch } : {}),
    ...(logger !== undefined ? { logger } : {}),
  };
}

export interface DrainLoopHandle {
  stop(): void;
}

/**
 * run the drainer on a fixed interval until stop() is called. each pass is
 * isolated — a crash is logged and the loop continues on the next tick.
 */
export function startOutboxDrainer(
  config: OutboxDrainerConfig,
  options: { intervalMs?: number } = {},
): DrainLoopHandle {
  const intervalMs = options.intervalMs ?? 1_000;
  const drainer = createOutboxDrainer(config);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await drainer.drainOnce();
    } catch (error) {
      config.logger?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "outbox drain pass crashed",
      );
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
