/**
 * preload — explicit ipc allowlist bridged into the approval renderer.
 * contextIsolation is on; nothing beyond this surface reaches the page.
 */
import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS, type ApprovalDecision, type ApprovalRequest } from "../approvals/types.js";

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS));

const assertAllowed = (channel: string): void => {
  if (!ALLOWED_CHANNELS.has(channel)) throw new Error(`ipc channel not allowed: ${channel}`);
};

const soonBridge = {
  getApprovalPayload: (): Promise<ApprovalRequest | undefined> => {
    assertAllowed(IPC_CHANNELS.getApprovalPayload);
    return ipcRenderer.invoke(IPC_CHANNELS.getApprovalPayload) as Promise<ApprovalRequest | undefined>;
  },
  decide: (decision: ApprovalDecision): void => {
    assertAllowed(IPC_CHANNELS.approvalDecision);
    ipcRenderer.send(IPC_CHANNELS.approvalDecision, decision);
  },
  onPayload: (cb: (payload: ApprovalRequest) => void): (() => void) => {
    assertAllowed(IPC_CHANNELS.approvalPayloadPush);
    const listener = (_event: unknown, payload: ApprovalRequest): void => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.approvalPayloadPush, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.approvalPayloadPush, listener);
  },
};

export type SoonBridge = typeof soonBridge;

contextBridge.exposeInMainWorld("soon", soonBridge);
