/**
 * approval window — small always-on-top react window for reviewing a
 * proposed message before it is sent.
 *
 * ⌘return sends ONLY while this window is focused: implemented with
 * `before-input-event` scoped to this window's webContents. no global
 * shortcut is registered for ⌘return — a globalShortcut may only be used
 * for an explicitly-configured optional binding (see src/shortcuts/).
 */
import path from "node:path";

import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS, type ApprovalDecision, type ApprovalRequest } from "./types.js";

/* injected by @electron-forge/plugin-vite at build time. */
declare const APPROVAL_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const APPROVAL_WINDOW_VITE_NAME: string | undefined;

export interface ApprovalWindowOptions {
  payload: ApprovalRequest;
  onDecision: (decision: ApprovalDecision) => void;
  preloadPath: string;
}

export interface ApprovalWindowHandle {
  window: BrowserWindow;
  close(): void;
}

let activeWindow: BrowserWindow | undefined;
let activePayload: ApprovalRequest | undefined;
let ipcWired = false;
let decisionSink: ((decision: ApprovalDecision) => void) | undefined;

const wireIpcOnce = (): void => {
  if (ipcWired) return;
  ipcWired = true;
  ipcMain.handle(IPC_CHANNELS.getApprovalPayload, () => activePayload);
  ipcMain.on(IPC_CHANNELS.approvalDecision, (event, decision: ApprovalDecision) => {
    if (activeWindow === undefined || event.sender !== activeWindow.webContents) return;
    decisionSink?.(decision);
    activeWindow.close();
  });
};

export const openApprovalWindow = (options: ApprovalWindowOptions): ApprovalWindowHandle => {
  wireIpcOnce();
  activePayload = options.payload;
  decisionSink = options.onDecision;

  if (activeWindow !== undefined && !activeWindow.isDestroyed()) {
    activeWindow.webContents.send(IPC_CHANNELS.approvalPayloadPush, options.payload);
    activeWindow.show();
    activeWindow.focus();
    return { window: activeWindow, close: () => activeWindow?.close() };
  }

  const window = new BrowserWindow({
    width: 420,
    height: 560,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    alwaysOnTop: true,
    title: "soon — review draft",
    backgroundColor: "#f9f7f3",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: options.preloadPath,
    },
  });
  activeWindow = window;

  // ⌘return sends only while this window is focused.
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (!input.meta || input.key.toLowerCase() !== "enter") return;
    if (!window.isFocused()) return;
    event.preventDefault();
    const payload = activePayload;
    if (payload === undefined) return;
    decisionSink?.({ draftId: payload.draftId, decision: "send" });
    window.close();
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (activeWindow === window) {
      activeWindow = undefined;
      activePayload = undefined;
      decisionSink = undefined;
    }
  });

  if (typeof APPROVAL_WINDOW_VITE_DEV_SERVER_URL === "string" && APPROVAL_WINDOW_VITE_DEV_SERVER_URL !== "") {
    void window.loadURL(APPROVAL_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    const name = typeof APPROVAL_WINDOW_VITE_NAME === "string" ? APPROVAL_WINDOW_VITE_NAME : "approval_window";
    void window.loadFile(path.join(import.meta.dirname, `../renderer/${name}/index.html`));
  }

  return { window, close: () => window.close() };
};
