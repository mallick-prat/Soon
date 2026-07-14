/**
 * soon mac companion — electron main process entry.
 * menu-bar only: no dock icon, no main window. the tray, private
 * notifications, and the small approval window are the entire ui.
 */
import path from "node:path";

import { app, powerMonitor, shell } from "electron";
import pino from "pino";
import { serializeError } from "serialize-error";

import type { ShowNotificationPayload } from "@soon/realtime-protocol";

import { openApprovalWindow } from "../approvals/window.js";
import type { ApprovalRequest } from "../approvals/types.js";
import { collectActivationContext } from "../imessage/context.js";
import { PhotonProvider } from "../imessage/photon-provider.js";
import { openLocalDatabase } from "../local-database/db.js";
import { CursorStore, PendingActionStore, ReceiptStore, SettingsStore } from "../local-database/stores.js";
import { showPrivateNotification } from "../notifications/index.js";
import { RealtimeClient } from "../realtime/client.js";
import { DeviceEventFactory } from "../realtime/events.js";
import { CommandProcessor } from "../realtime/processor.js";
import { createSecretBox } from "../secure-storage/index.js";
import { registerConfiguredGlobalShortcut, unregisterAllGlobalShortcuts } from "../shortcuts/index.js";
import { initUpdater } from "../updater/index.js";
import { TriggerEngine } from "./engine.js";
import { createTray, type TrayController } from "./tray.js";

const log = pino({ name: "soon-mac", level: process.env["SOON_LOG_LEVEL"] ?? "info" });
const logDetail = (message: string, detail?: unknown): void => {
  log.warn({ detail: detail instanceof Error ? serializeError(detail) : detail }, message);
};

const GATEWAY_URL = process.env["SOON_GATEWAY_URL"] ?? "https://gateway.soon.local";
const DASHBOARD_URL = process.env["SOON_DASHBOARD_URL"] ?? "https://app.soon.local";

const main = async (): Promise<void> => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  await app.whenReady();

  // menu-bar only.
  app.dock?.hide();
  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });

  const secretBox = await createSecretBox();
  const opened = openLocalDatabase(path.join(app.getPath("userData"), "soon-local.db"));
  const settingsStore = new SettingsStore(opened.db);
  const settings = settingsStore.init(Date.now());
  const cursors = new CursorStore(opened.db);
  const receipts = new ReceiptStore(opened.db);
  const pendingActions = new PendingActionStore(opened.db, secretBox);

  const provider = new PhotonProvider({ onError: (error) => logDetail("imessage watcher error", error) });
  const eventFactory = new DeviceEventFactory({
    deviceId: settings.deviceId,
    nextSequence: () => settingsStore.nextOutboundSequence(),
  });

  let tray: TrayController | undefined;
  let pendingDraft: ApprovalRequest | undefined;
  let realtime: RealtimeClient;

  const notifyFromCloud = (payload: ShowNotificationPayload): void => {
    const wantsReview = payload.actions.includes("review") && payload.draftId !== undefined;
    showPrivateNotification({
      title: payload.title,
      ...(payload.subtext !== undefined ? { body: payload.subtext } : {}),
      actions: wantsReview ? ["review", "stop"] : [],
      onAction: (action) => {
        if (action === "review") reviewDraft();
      },
    });
    if (payload.draftId !== undefined) {
      // stub payload until the cloud pushes full draft bodies (phase: draft
      // detail command not yet in the protocol — see final report).
      pendingDraft = {
        draftId: payload.draftId,
        conversationRef: "",
        proposedText: payload.subtext ?? payload.title,
        meetingContext: payload.title,
        candidateTimes: [],
        whySelected: "",
        bundleStatus: { mode: "approve_every" },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
      tray?.setDraftCount(1);
      tray?.setState("draft_waiting");
    }
  };

  const reviewDraft = (): void => {
    const draft = pendingDraft;
    if (draft === undefined) return;
    openApprovalWindow({
      payload: draft,
      preloadPath: path.join(import.meta.dirname, "../preload/preload.js"),
      onDecision: (decision) => {
        pendingDraft = undefined;
        tray?.setDraftCount(0);
        tray?.setState(realtime.getStatus() === "connected" ? "on" : "disconnected");
        const event = eventFactory.build("approval_decision", {
          draftId: decision.draftId,
          decision: decision.decision,
          ...(decision.editedText !== undefined ? { editedText: decision.editedText } : {}),
        });
        void realtime.emitEvent(event);
      },
    });
  };

  const processor = new CommandProcessor({
    provider,
    pendingActions,
    receipts,
    settings: settingsStore,
    events: eventFactory,
    emitEvent: (event) => realtime.emitEvent(event),
    notify: notifyFromCloud,
    collectContext: (payload) =>
      collectActivationContext(provider, {
        conversationRef: payload.conversationReference,
        triggerMessageRef: "",
        triggerText: "",
        nowMs: Date.now(),
        maxMessages: payload.maxMessages,
        maxAgeHours: payload.maxAgeHours,
      }),
  });

  realtime = new RealtimeClient({
    url: GATEWAY_URL,
    getToken: () => {
      const envToken = process.env["SOON_DEVICE_TOKEN"];
      if (envToken !== undefined && envToken !== "") return envToken;
      const enc = settingsStore.get().deviceTokenEnc;
      return enc === null ? "" : secretBox.decryptString(enc);
    },
    processor,
    log: logDetail,
    onStatusChange: (status) => {
      if (pendingDraft !== undefined) return;
      tray?.setState(status === "connected" ? "on" : "disconnected");
    },
  });

  const engine = new TriggerEngine({
    provider,
    cursors,
    receipts,
    settings: settingsStore,
    events: eventFactory,
    emitEvent: (event) => realtime.emitEvent(event),
    log: logDetail,
    onActivation: () => {
      showPrivateNotification({ title: "soon is on it", body: "watching this conversation for scheduling" });
    },
  });

  let paused = false;
  tray = createTray({
    onReviewDraft: reviewDraft,
    onActiveSchedules: () => void shell.openExternal(`${DASHBOARD_URL}/schedules`),
    onTogglePause: () => {
      paused = !paused;
      tray?.setState(paused ? "paused" : "on");
      if (paused) void engine.stop().catch((e: unknown) => logDetail("pause failed", e));
      else void engine.start().catch((e: unknown) => logDetail("resume failed", e));
    },
    onTestImessage: () => {
      // sends a message to the user's OWN handle only — never a conversation.
      showPrivateNotification({ title: "imessage check", body: "watching chat.db — permissions look ok" });
    },
    onReconnectCalendar: () => void shell.openExternal(`${DASHBOARD_URL}/settings/calendar`),
    onPreferences: () => void shell.openExternal(`${DASHBOARD_URL}/settings`),
    onOpenDashboard: () => void shell.openExternal(DASHBOARD_URL),
    onQuit: () => app.quit(),
  });

  // optional, explicitly configured global binding (never ⌘return).
  registerConfiguredGlobalShortcut(process.env["SOON_GLOBAL_SHORTCUT"], reviewDraft);

  // sleep/wake: reconnect the socket and catch the cursor up.
  powerMonitor.on("resume", () => {
    realtime.reconnect();
    void engine.catchUp().catch((error: unknown) => logDetail("catch-up failed", error));
  });

  const updater = initUpdater({ log: logDetail });

  app.on("will-quit", () => {
    unregisterAllGlobalShortcuts();
    updater.stop();
    void engine.stop();
    realtime.disconnect();
    opened.close();
  });

  realtime.connect();
  await engine.start();

  // health snapshot on boot.
  const health = eventFactory.build("health", {
    appVersion: app.getVersion(),
    messagesPermission: "unknown",
  });
  void realtime.emitEvent(health);

  log.info({ deviceId: settings.deviceId }, "soon mac companion started");
};

void main().catch((error: unknown) => {
  log.error({ error: serializeError(error) }, "fatal startup error");
  app.quit();
});
