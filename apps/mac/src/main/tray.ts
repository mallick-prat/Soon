/** menu-bar tray — the app's entire persistent ui. all copy lowercase. */
import { Menu, Tray, nativeImage } from "electron";

export type TrayState = "on" | "paused" | "draft_waiting" | "disconnected" | "needs_permission";

const STATE_LABEL: Record<TrayState, string> = {
  on: "soon is on",
  paused: "soon is paused",
  draft_waiting: "draft waiting for review",
  disconnected: "disconnected — retrying",
  needs_permission: "needs full disk access",
};

const STATE_GLYPH: Record<TrayState, string> = {
  on: "soon",
  paused: "soon ⏸",
  draft_waiting: "soon ●",
  disconnected: "soon ◌",
  needs_permission: "soon !",
};

export interface TrayHandlers {
  onReviewDraft: () => void;
  onActiveSchedules: () => void;
  onTogglePause: () => void;
  onTestImessage: () => void;
  onReconnectCalendar: () => void;
  onPairDevice: () => void;
  onPreferences: () => void;
  onOpenDashboard: () => void;
  onQuit: () => void;
}

export interface TrayController {
  setState(state: TrayState): void;
  setDraftCount(count: number): void;
  destroy(): void;
}

export const createTray = (handlers: TrayHandlers): TrayController => {
  // text-only menu bar item; template image keeps it monochrome.
  const tray = new Tray(nativeImage.createEmpty());
  let state: TrayState = "on";
  let draftCount = 0;

  const rebuild = (): void => {
    tray.setTitle(STATE_GLYPH[state], { fontType: "monospacedDigit" });
    tray.setToolTip(STATE_LABEL[state]);
    const menu = Menu.buildFromTemplate([
      { label: STATE_LABEL[state], enabled: false },
      { type: "separator" },
      {
        label: draftCount > 0 ? `review draft (${draftCount})` : "review draft",
        enabled: draftCount > 0,
        click: handlers.onReviewDraft,
      },
      { label: "active schedules", click: handlers.onActiveSchedules },
      { type: "separator" },
      { label: state === "paused" ? "resume" : "pause", click: handlers.onTogglePause },
      { label: "test imessage", click: handlers.onTestImessage },
      { label: "reconnect calendar", click: handlers.onReconnectCalendar },
      { label: "pair device", click: handlers.onPairDevice },
      { type: "separator" },
      { label: "preferences…", click: handlers.onPreferences },
      { label: "open dashboard", click: handlers.onOpenDashboard },
      { type: "separator" },
      { label: "quit soon", click: handlers.onQuit },
    ]);
    tray.setContextMenu(menu);
  };

  rebuild();

  return {
    setState: (next) => {
      state = next;
      rebuild();
    },
    setDraftCount: (count) => {
      draftCount = count;
      rebuild();
    },
    destroy: () => tray.destroy(),
  };
};
