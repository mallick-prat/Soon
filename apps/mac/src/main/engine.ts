/**
 * trigger engine — orchestrates provider messages through dedupe,
 * batching, trigger detection, cursor advancement, and device events.
 * deliberately electron-free so it is fully unit-testable.
 */
import { CONTEXT_LIMITS } from "@soon/shared-types";
import type { DeviceEvent } from "@soon/realtime-protocol";

import { collectActivationContext } from "../imessage/context.js";
import { FragmentBatcher, type Clock } from "../imessage/debounce.js";
import { detectTrigger, type TriggerResult, type UserCommand } from "../imessage/trigger.js";
import type { ImessageProvider, LocalMessage, Unsubscribe } from "../imessage/types.js";
import type { CursorStore, ReceiptStore, SettingsStore } from "../local-database/stores.js";
import type { DeviceEventFactory, DeviceEventPayload } from "../realtime/events.js";

const HOUR_MS = 3_600_000;

export interface TriggerEngineDeps {
  provider: ImessageProvider;
  cursors: CursorStore;
  receipts: ReceiptStore;
  settings: SettingsStore;
  events: DeviceEventFactory;
  emitEvent: (event: DeviceEvent) => void | Promise<void>;
  /** local hook: a trigger fired (tray/notification updates). */
  onActivation?: (conversationRef: string, modifierText: string) => void;
  /** local hook: a user command was recognized. */
  onCommand?: (conversationRef: string, command: UserCommand) => void;
  clock?: Clock;
  now?: () => number;
  log?: (message: string, detail?: unknown) => void;
}

export class TriggerEngine {
  private readonly deps: TriggerEngineDeps;
  private readonly batcher: FragmentBatcher;
  private readonly now: () => number;
  private unsubscribe: Unsubscribe | undefined;

  constructor(deps: TriggerEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.batcher = new FragmentBatcher({
      onBatch: (conversationRef, messages) => {
        void this.handleBatch(conversationRef, messages).catch((error) =>
          deps.log?.("batch handling failed", error),
        );
      },
      ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
    });
  }

  async start(): Promise<void> {
    this.unsubscribe = this.deps.provider.onMessage((msg) => {
      void this.handleIncoming(msg).catch((error) => this.deps.log?.("message handling failed", error));
    });
    await this.deps.provider.start();
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.batcher.dispose();
    await this.deps.provider.stop();
  }

  /** after sleep/wake or reconnect: replay anything newer than each cursor. */
  async catchUp(): Promise<void> {
    for (const cursor of this.deps.cursors.all()) {
      const since = Math.max(cursor.lastMessageAtMs + 1, this.now() - CONTEXT_LIMITS.maxAgeHours * HOUR_MS);
      const missed = await this.deps.provider.getRecentMessages(
        cursor.conversationRef,
        CONTEXT_LIMITS.maxMessages,
        since,
      );
      for (const msg of missed) await this.handleIncoming(msg);
    }
  }

  async handleIncoming(msg: LocalMessage): Promise<void> {
    // dedupe on the stable local message reference.
    if (!this.deps.receipts.recordIfNew(`msg:${msg.ref}`, msg.text, this.now())) return;

    const cursor = this.deps.cursors.get(msg.conversationRef);

    if (!msg.isFromMe) {
      // attendee replied — widen the batching window and, when a session is
      // active, forward the inbound message to the cloud.
      this.batcher.setAttendeeReplying(msg.conversationRef, true);
      if (cursor.activeSessionId !== null && msg.sentAtMs > cursor.lastMessageAtMs) {
        this.deps.cursors.advance(msg.conversationRef, msg.ref, msg.sentAtMs);
        await this.emit(
          "inbound_message",
          {
            conversationReference: msg.conversationRef,
            localMessageReference: msg.ref,
            text: msg.text,
            sentAt: new Date(msg.sentAtMs).toISOString(),
            senderIsUser: false,
          },
          cursor.activeSessionId,
        );
      }
      return;
    }

    // user-authored fragments batch into one interpretation unit.
    this.batcher.push(msg);
  }

  private async handleBatch(conversationRef: string, messages: LocalMessage[]): Promise<void> {
    const first = messages[0];
    if (first === undefined) return;
    const settings = this.deps.settings.get();
    const cursor = this.deps.cursors.get(conversationRef);

    const participantCount = first.isGroup ? await this.countParticipants(conversationRef) : 2;

    const result: TriggerResult = detectTrigger(first, {
      triggerEmoji: settings.triggerEmoji,
      installedAtMs: settings.installedAtMs,
      cursorMs: cursor.lastMessageAtMs,
      conversationBlocked: cursor.blocked,
      conversationPaused: cursor.paused,
      hasActiveSession: cursor.activeSessionId !== null,
      participantCount,
    });

    // every user-authored message advances the cursor once looked at.
    const last = messages[messages.length - 1] ?? first;
    this.deps.cursors.advance(conversationRef, last.ref, last.sentAtMs);

    if (result.type === "ignored") {
      // forward user fragments during an active session so the cloud can
      // interpret them (e.g. answering its own scheduling question).
      if (cursor.activeSessionId !== null && result.reason !== "not_from_me") {
        for (const msg of messages) {
          await this.emit(
            "inbound_message",
            {
              conversationReference: conversationRef,
              localMessageReference: msg.ref,
              text: msg.text,
              sentAt: new Date(msg.sentAtMs).toISOString(),
              senderIsUser: true,
            },
            cursor.activeSessionId,
          );
        }
      }
      return;
    }

    if (result.type === "command") {
      this.applyCommandLocally(conversationRef, result.command);
      this.deps.onCommand?.(conversationRef, result.command);
      // the cloud interprets commands too — forward the raw text.
      await this.emit(
        "inbound_message",
        {
          conversationReference: conversationRef,
          localMessageReference: first.ref,
          text: first.text,
          sentAt: new Date(first.sentAtMs).toISOString(),
          senderIsUser: true,
        },
        cursor.activeSessionId ?? undefined,
      );
      return;
    }

    // activation — trailing fragments extend the modifier text.
    const modifierText = [result.modifierText, ...messages.slice(1).map((m) => m.text)]
      .filter((part) => part !== "")
      .join("\n");

    await this.emit("trigger_detected", {
      conversationReference: conversationRef,
      triggerMessageReference: first.ref,
      triggerText: modifierText === "" ? first.text : `${settings.triggerEmoji} ${modifierText}`,
      sentAt: new Date(first.sentAtMs).toISOString(),
      isGroup: first.isGroup,
      participantCount,
    });

    // proactive bounded context upload (also happens on collect_context).
    try {
      const context = await collectActivationContext(this.deps.provider, {
        conversationRef,
        triggerMessageRef: first.ref,
        triggerText: first.text,
        nowMs: this.now(),
      });
      await this.emit("context_collected", { conversationReference: conversationRef, context });
    } catch (error) {
      this.deps.log?.("context collection failed", error);
    }

    this.deps.onActivation?.(conversationRef, modifierText);
  }

  private applyCommandLocally(conversationRef: string, command: UserCommand): void {
    switch (command.kind) {
      case "stop":
        this.deps.cursors.setBlocked(conversationRef, true);
        break;
      case "resume":
        this.deps.cursors.setBlocked(conversationRef, false);
        this.deps.cursors.setPaused(conversationRef, false);
        break;
      case "take_over":
        this.deps.cursors.setPaused(conversationRef, true);
        break;
      default:
        break;
    }
  }

  private async countParticipants(conversationRef: string): Promise<number> {
    const recent = await this.deps.provider.getRecentMessages(
      conversationRef,
      CONTEXT_LIMITS.maxMessages,
      this.now() - CONTEXT_LIMITS.maxAgeHours * HOUR_MS,
    );
    const handles = new Set<string>();
    for (const msg of recent) {
      if (!msg.isFromMe) for (const handle of msg.participantHandles) handles.add(handle);
    }
    // attendees seen recently + the user. best effort — the local provider
    // cannot enumerate group members directly.
    return handles.size + 1;
  }

  private async emit<T extends DeviceEvent["type"]>(
    type: T,
    payload: DeviceEventPayload<T>,
    sessionId?: string,
  ): Promise<void> {
    const event = this.deps.events.build(type, payload, sessionId);
    await this.deps.emitEvent(event);
  }
}
