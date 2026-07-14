import { defineConfig } from "@trigger.dev/sdk";

import { configureWorker } from "./src/bootstrap.js";

/**
 * trigger.dev project config. tasks live in src/trigger (scheduling-session,
 * retention). the init hook wires the composition root before any task run
 * resolves getComposition(), so scheduling steps run against prisma / the
 * calendar / the llm and dispatch commands to the outbox.
 */
export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_soon",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  init: async () => {
    configureWorker();
  },
});
