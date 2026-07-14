/**
 * cloud command processing — transport-agnostic so tests can drive it
 * without a socket. every command is validated, sequence-checked,
 * expiry-checked, deduped, executed, and acked.
 *
 * invariant: for send_message, the delivery result is persisted in the
 * pending_actions outbox BEFORE the ack is returned — socket delivery is
 * never treated as message delivery.
 */
import {
  cloudCommandSchema,
  type Ack,
  type CloudCommand,
  type ShowNotificationPayload,
  type CollectContextPayload,
  type SendMessagePayload,
  type RequestApprovalPayload,
} from "@soon/realtime-protocol";
import type { ActivationContext } from "@soon/shared-types";

import type { ImessageProvider } from "../imessage/types.js";
import type { PendingActionStore, ReceiptStore, SettingsStore } from "../local-database/stores.js";
import type { DeviceEventFactory, DeviceEventPayload } from "./events.js";
import type { DeviceEvent } from "@soon/realtime-protocol";

export interface CommandProcessorDeps {
  provider: ImessageProvider;
  pendingActions: PendingActionStore;
  receipts: ReceiptStore;
  settings: SettingsStore;
  events: DeviceEventFactory;
  /** deliver a validated device event to the cloud (fire and forget ok). */
  emitEvent: (event: DeviceEvent) => void | Promise<void>;
  collectContext: (payload: CollectContextPayload) => Promise<ActivationContext>;
  /** show a private local notification. NEVER sends into the conversation. */
  notify?: (payload: ShowNotificationPayload) => void;
  /**
   * show the private approval window for a proposed draft. fire-and-forget:
   * the user's choice returns later as an `approval_decision` device event,
   * so the command is acked as soon as the window is presented.
   */
  requestApproval?: (payload: RequestApprovalPayload) => void;
  now?: () => number;
}

const ack = (ok: boolean, id: string, errorCode?: string, message?: string): Ack => ({
  ok,
  id,
  ...(errorCode !== undefined ? { errorCode } : {}),
  ...(message !== undefined ? { message } : {}),
});

const idOf = (raw: unknown): string => {
  if (typeof raw === "object" && raw !== null && "commandId" in raw) {
    const candidate = (raw as { commandId: unknown }).commandId;
    if (typeof candidate === "string") return candidate;
  }
  return "unknown";
};

export class CommandProcessor {
  private readonly deps: CommandProcessorDeps;
  private readonly now: () => number;

  constructor(deps: CommandProcessorDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(raw: unknown): Promise<Ack> {
    const parsed = cloudCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return ack(false, idOf(raw), "invalid_command", "command failed schema validation");
    }
    const command = parsed.data;

    // sequence monotonicity per device — replays/regressions are rejected.
    if (!this.deps.settings.acceptInboundSequence(command.sequenceNumber)) {
      return ack(false, command.commandId, "sequence_regression");
    }

    // expiry — expired commands are acked as failed and reported.
    const expiresAtMs = Date.parse(command.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= this.now()) {
      await this.emit("command_expired", { commandId: command.commandId }, command.sessionId);
      return ack(false, command.commandId, "expired");
    }

    // idempotency — a replayed command acks ok without re-executing.
    const receiptKey = `cmd:${command.idempotencyKey}`;
    if (!this.deps.receipts.recordIfNew(receiptKey, JSON.stringify(command.payload), this.now())) {
      return ack(true, command.commandId, undefined, "duplicate — already processed");
    }

    switch (command.type) {
      case "send_message":
        return this.handleSendMessage(command, command.payload);
      case "request_approval":
        // present the draft locally; the decision returns as its own event.
        this.deps.requestApproval?.(command.payload);
        return ack(true, command.commandId);
      case "collect_context":
        return this.handleCollectContext(command, command.payload);
      case "show_notification":
        this.deps.notify?.(command.payload);
        return ack(true, command.commandId);
      case "cancel_command": {
        this.deps.pendingActions.cancelByCommandId(command.payload.targetCommandId);
        return ack(true, command.commandId);
      }
      case "ping":
        return ack(true, command.commandId);
    }
  }

  private async handleSendMessage(command: CloudCommand, payload: SendMessagePayload): Promise<Ack> {
    const nowMs = this.now();
    // stage into the outbox, then atomically acquire before sending.
    const actionId = this.deps.pendingActions.create({
      commandId: command.commandId,
      conversationRef: payload.conversationReference,
      payload,
      expiresAtMs: Date.parse(command.expiresAt),
      nowMs,
    });
    const acquired = this.deps.pendingActions.acquire<SendMessagePayload>(actionId, nowMs);
    if (acquired === undefined) {
      await this.emit("send_failed", {
        commandId: command.commandId,
        draftId: payload.draftId,
        errorCode: "not_acquirable",
      }, command.sessionId);
      return ack(false, command.commandId, "not_acquirable");
    }

    const result = await this.deps.provider.sendMessage(acquired.payload.conversationReference, acquired.payload.text);

    // persist the delivery result BEFORE acking.
    if (result.ok) {
      this.deps.pendingActions.markSent(actionId, result.sentAtMs, result.localMessageRef);
      await this.emit("message_sent", {
        commandId: command.commandId,
        draftId: payload.draftId,
        ...(result.localMessageRef !== undefined ? { localMessageReference: result.localMessageRef } : {}),
        sentAt: new Date(result.sentAtMs).toISOString(),
      }, command.sessionId);
      return ack(true, command.commandId);
    }

    this.deps.pendingActions.markFailed(actionId, result.errorMessage ?? result.errorCode ?? "send_failed");
    await this.emit("send_failed", {
      commandId: command.commandId,
      draftId: payload.draftId,
      errorCode: result.errorCode ?? "send_failed",
      ...(result.errorMessage !== undefined ? { message: result.errorMessage } : {}),
    }, command.sessionId);
    return ack(false, command.commandId, result.errorCode ?? "send_failed");
  }

  private async handleCollectContext(command: CloudCommand, payload: CollectContextPayload): Promise<Ack> {
    try {
      const context = await this.deps.collectContext(payload);
      await this.emit("context_collected", {
        conversationReference: payload.conversationReference,
        context,
        inResponseToCommandId: command.commandId,
      }, command.sessionId);
      return ack(true, command.commandId);
    } catch (error) {
      return ack(false, command.commandId, "context_failed", error instanceof Error ? error.message : String(error));
    }
  }

  private async emit<T extends DeviceEvent["type"]>(
    type: T,
    payload: DeviceEventPayload<T>,
    sessionId: string | undefined,
  ): Promise<void> {
    const event = this.deps.events.build(type, payload, sessionId);
    await this.deps.emitEvent(event);
  }
}
