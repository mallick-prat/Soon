import { createLogger } from "@soon/observability";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { createForwardingEventSink } from "./forwarding-sink.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    name: "realtime-gateway",
    ...(config.LOG_LEVEL !== undefined ? { level: config.LOG_LEVEL } : {}),
  });
  // when a worker ingress URL is configured, forward validated device events to
  // it so 📅 context drives autonomous scheduling; otherwise events land in the
  // default in-memory sink.
  const sink =
    config.WORKER_EVENTS_URL !== undefined
      ? createForwardingEventSink({
          url: config.WORKER_EVENTS_URL,
          internalToken: config.INTERNAL_API_TOKEN,
          logger,
        })
      : undefined;
  if (sink !== undefined) {
    logger.info({ workerEventsUrl: config.WORKER_EVENTS_URL }, "forwarding device events to worker");
  }
  const gateway = await buildApp({ config, logger, ...(sink !== undefined ? { sink } : {}) });
  await gateway.app.listen({ port: config.PORT, host: "0.0.0.0" });
  logger.info({ port: config.PORT }, "realtime gateway listening");

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    void gateway.app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  // config/boot failures — error messages never contain secret values
  console.error("gateway failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
