/**
 * soon mac companion — electron main process entry.
 * menu-bar only: no dock icon, no main window. the tray, private
 * notifications, and the small approval window are the entire ui.
 */
import path from "node:path";

import { app, powerMonitor, shell } from "electron";
import pino from "pino";
import { serializeError } from "serialize-error";

import type { RequestApprovalPayload, ShowNotificationPayload } from "@soon/realtime-protocol";

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
import { DeviceEnroller } from "../enrollment/enroller.js";
import { createSettingsEnrollmentStore } from "../enrollment/store.js";
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

  // device enrollment: pairs the mac with the backend and keeps the gateway
  // access token fresh. an optional boot code enables headless/dev pairing.
  const enroller = new DeviceEnroller({
    store: createSettingsEnrollmentStore(settingsStore, secretBox),
    post: async (routePath, body) => {
      const res = await fetch(`${DASHBOARD_URL}${routePath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },
    appVersion: app.getVersion(),
  });
  const bootEnrollmentCode = process.env["SOON_ENROLLMENT_CODE"];
  if (bootEnrollmentCode !== undefined && bootEnrollmentCode !== "" && !enroller.isEnrolled()) {
    try {
      const { serverDeviceId } = await enroller.register(bootEnrollmentCode);
      log.info({ serverDeviceId }, "device enrolled from boot code");
    } catch (error) {
      logDetail("device enrollment failed", error);
    }
  }

  const provider = new PhotonProvider({ onError: (error) => logDetail("imessage watcher error", error) });
  const eventFactory = new DeviceEventFactory({
    // post-enrollment this is the server mac_devices.id — the id the gateway
    // authenticates the socket with and routes commands on.
    deviceId: settingsStore.get().deviceId,
    nextSequence: () => settingsStore.nextOutboundSequence(),
  });

  let tray: TrayController | undefined;
  let pendingDraft: ApprovalRequest | undefined;
  let realtime: RealtimeClient;

  // general private notifications ("soon is on it", "scheduled with alex",
  // failures). the "review" action opens whatever draft is currently pending.
  const notifyFromCloud = (payload: ShowNotificationPayload): void => {
    const wantsReview = payload.actions.includes("review") && pendingDraft !== undefined;
    showPrivateNotification({
      title: payload.title,
      ...(payload.subtext !== undefined ? { body: payload.subtext } : {}),
      actions: wantsReview ? ["review", "stop"] : [],
      onAction: (action) => {
        if (action === "review") reviewDraft();
      },
    });
  };

  // a draft arrived for local approval (request_approval command). store the
  // full draft and surface it privately — the window shows real content now.
  const receiveDraftForApproval = (payload: RequestApprovalPayload): void => {
    pendingDraft = {
      draftId: payload.draftId,
      conversationRef: payload.conversationReference,
      proposedText: payload.proposedText,
      meetingContext: payload.meetingContext,
      candidateTimes: payload.candidateTimes,
      whySelected: payload.whySelected,
      bundleStatus: payload.bundleStatus,
      expiresAt: payload.expiresAt,
    };
    tray?.setDraftCount(1);
    tray?.setState("draft_waiting");
    showPrivateNotification({
      title: "soon is handling this",
      ...(payload.meetingContext !== "" ? { body: payload.meetingContext } : {}),
      actions: ["review", "stop"],
      onAction: (action) => {
        if (action === "review") {
          reviewDraft();
          return;
        }
        // dismissed from the notification — report the decline upstream.
        pendingDraft = undefined;
        tray?.setDraftCount(0);
        tray?.setState(realtime.getStatus() === "connected" ? "on" : "disconnected");
        void realtime.emitEvent(
          eventFactory.build("approval_decision", { draftId: payload.draftId, decision: "stop" }),
        );
      },
    });
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
    requestApproval: receiveDraftForApproval,
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
    getToken: async () => {
      const envToken = process.env["SOON_DEVICE_TOKEN"];
      if (envToken !== undefined && envToken !== "") return envToken;
      // refreshes via device-key proof when the token nears expiry.
      return enroller.getAccessToken();
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

  // only connect to the gateway once we have a device identity — an
  // unenrolled mac has no valid token and would just fail auth in a loop.
  const canConnect =
    enroller.isEnrolled() ||
    (process.env["SOON_DEVICE_TOKEN"] !== undefined && process.env["SOON_DEVICE_TOKEN"] !== "");
  if (canConnect) {
    realtime.connect();
  } else {
    tray?.setState("needs_permission");
    log.info("device not enrolled — pair it from the dashboard to connect");
  }
  await engine.start();

  // health snapshot on boot.
  if (canConnect) {
    const health = eventFactory.build("health", {
      appVersion: app.getVersion(),
      messagesPermission: "unknown",
    });
    void realtime.emitEvent(health);
  }

  log.info({ deviceId: settings.deviceId }, "soon mac companion started");
};

void main().catch((error: unknown) => {
  log.error({ error: serializeError(error) }, "fatal startup error");
  app.quit();
});
