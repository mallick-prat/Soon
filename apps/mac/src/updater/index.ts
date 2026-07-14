/**
 * auto-update — squirrel.mac via electron's built-in autoUpdater.
 * only active in packaged builds with a configured feed url.
 */
import { app, autoUpdater } from "electron";

export interface UpdaterOptions {
  feedUrl?: string;
  /** check interval; default 4h. */
  intervalMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

export interface UpdaterHandle {
  stop(): void;
}

export const initUpdater = (options: UpdaterOptions = {}): UpdaterHandle => {
  const noop: UpdaterHandle = { stop: () => undefined };
  const feedUrl = options.feedUrl ?? process.env["SOON_UPDATE_FEED_URL"];
  if (!app.isPackaged || feedUrl === undefined || feedUrl === "") return noop;

  try {
    autoUpdater.setFeedURL({ url: feedUrl, serverType: "json" });
  } catch (error) {
    options.log?.("updater feed configuration failed", error);
    return noop;
  }

  autoUpdater.on("error", (error) => options.log?.("updater error", error));
  autoUpdater.on("update-downloaded", () => options.log?.("update downloaded; will install on quit"));

  const check = (): void => {
    try {
      autoUpdater.checkForUpdates();
    } catch (error) {
      options.log?.("update check failed", error);
    }
  };
  check();
  const timer = setInterval(check, options.intervalMs ?? 4 * 3_600_000);
  return { stop: () => clearInterval(timer) };
};
