import { createLogger } from "@soon/observability";
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({
    name: "realtime-gateway",
    ...(config.LOG_LEVEL !== undefined ? { level: config.LOG_LEVEL } : {}),
  });
  const gateway = await buildApp({ config, logger });
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
