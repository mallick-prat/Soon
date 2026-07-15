/**
 * drainer service entry.
 *
 * this is the long-running process that makes the command loop fire: it drains
 * outbox_commands and relays each to the gateway (which delivers to the mac).
 * it is transport-only — the scheduling tasks run on the trigger.dev runtime
 * (configured via ../trigger.config.ts), so this process does NOT build the
 * llm/calendar composition and needs only the drainer's env.
 */
import { pathToFileURL } from "node:url";

import { closeDb } from "@soon/database";
import { createLogger, type Logger } from "@soon/observability";

import type { OutboxDrainerConfig } from "./adapters/outbox-drainer.js";
import {
  configureWorker,
  loadDrainerConfigFromEnv,
  startDeviceEventServer,
  startOutboxDrainer,
  type DeviceEventServerHandle,
} from "./bootstrap.js";

export interface DrainerService {
  stop(): Promise<void>;
}

export interface StartDrainerServiceOptions {
  /** bypass env config — used by tests */
  config?: OutboxDrainerConfig;
  intervalMs?: number;
  logger?: Logger;
}

/**
 * start the outbox drainer loop. returns a handle whose stop() halts the loop
 * and disconnects the db. no signal handlers are installed here so the service
 * stays unit-testable; runDrainerProcess() wires those for the real process.
 */
export function startDrainerService(options: StartDrainerServiceOptions = {}): DrainerService {
  const logger = options.logger ?? createLogger({ name: "soon-worker-drainer" });
  const config = options.config ?? loadDrainerConfigFromEnv(process.env, logger);
  logger.info({ gatewayUrl: config.gatewayUrl }, "outbox drainer starting");

  const handle = startOutboxDrainer(
    config,
    options.intervalMs !== undefined ? { intervalMs: options.intervalMs } : {},
  );

  let stopped = false;
  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      handle.stop();
      await closeDb();
      logger.info("outbox drainer stopped");
    },
  };
}

/**
 * process entry: start the outbox drainer, and — when the scheduling env is
 * present (LLM_API_KEY) — also configure the composition root and expose the
 * device-event ingress server so forwarded 📅 context drives real proposals.
 * shuts down cleanly on SIGINT/SIGTERM.
 */
export function runWorkerProcess(): void {
  const logger = createLogger({ name: "soon-worker" });
  const drainer = startDrainerService({ logger });

  let events: DeviceEventServerHandle | undefined;
  if (process.env["LLM_API_KEY"] !== undefined && process.env["LLM_API_KEY"] !== "") {
    configureWorker({ logger });
    const port = Number(process.env["WORKER_EVENTS_PORT"] ?? "8788");
    events = startDeviceEventServer({
      port,
      internalToken: process.env["INTERNAL_API_TOKEN"] ?? "",
      logger,
    });
    logger.info({ port }, "device-event ingress listening");
  } else {
    logger.warn("LLM_API_KEY unset — running drainer only (no autonomous scheduling)");
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    void Promise.allSettled([events?.stop(), drainer.stop()])
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
    // reference the signal so the intent is clear in logs/traces
    void signal;
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// run only when executed directly (never when imported by a test).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkerProcess();
}
