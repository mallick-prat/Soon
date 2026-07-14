import { schedules } from "@trigger.dev/sdk";

/**
 * nightly retention: raw session message text expires after 30 days by
 * default; structured metadata (states, slots, audit trail) remains.
 */
export const retentionTask = schedules.task({
  id: "retention-sweep",
  cron: "0 8 * * *", // 08:00 utc daily
  run: async () => {
    const { getComposition } = await import("../composition.js");
    const comp = getComposition();
    const deleted = await comp.retention.expireSessionMessageText(30);
    comp.logger.info({ deleted }, "retention sweep complete");
    return { deleted };
  },
});
