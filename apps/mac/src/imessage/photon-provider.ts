/**
 * photon adapter — maps @spectrum-ts/imessage-local onto the narrow
 * ImessageProvider contract. ALL photon imports live in this file.
 *
 * what the real package looks like (v10):
 *   - `@spectrum-ts/imessage-local` exports a spectrum `Platform` named
 *     `imessage` built with `definePlatform("iMessage", ...)`. its
 *     `lifecycle.createClient` constructs an `IMessageSDK` from
 *     `@photon-ai/imessage-kit` (chat.db watcher + AppleScript sender).
 *   - the platform-level `messages` stream only surfaces *incoming*
 *     messages (`onIncomingMessage`), never from-me rows — but trigger
 *     detection requires the user's own messages. so we obtain the
 *     underlying kit client through the platform definition and drive
 *     `startWatching({ onIncomingMessage, onFromMeMessage })` ourselves.
 */
import { imessage } from "@spectrum-ts/imessage-local";

import type { ImessageProvider, LocalMessage, SendResult, Unsubscribe } from "./types.js";

/* structural view of the parts of @photon-ai/imessage-kit's SDK we use.
 * (the kit is a transitive dependency; we never import its types directly.) */
interface KitMessage {
  readonly rowId: number;
  readonly id: string;
  readonly chatId: string | null;
  readonly chatKind: "dm" | "group" | "unknown";
  readonly participant: string | null;
  readonly text: string | null;
  readonly kind: string;
  readonly isFromMe: boolean;
  readonly createdAt: Date;
}

interface KitMessageQuery {
  readonly chatId?: string;
  readonly isFromMe?: boolean;
  readonly excludeReactions?: boolean;
  readonly since?: Date;
  readonly limit?: number;
}

interface KitWatchEvents {
  readonly onIncomingMessage?: (message: KitMessage) => void | Promise<void>;
  readonly onFromMeMessage?: (message: KitMessage) => void | Promise<void>;
  readonly onError?: (error: Error) => void;
}

interface ImessageKitSdk {
  getMessages(query?: KitMessageQuery): Promise<readonly KitMessage[]>;
  send(request: { to: string; text?: string }): Promise<void>;
  startWatching(events?: KitWatchEvents): Promise<void>;
  stopWatching(): Promise<void>;
  close(): Promise<void>;
}

const toLocalMessage = (m: KitMessage): LocalMessage | undefined => {
  // rare WAL race: chat unknown — skip routing, per kit docs.
  if (m.chatId === null) return undefined;
  return {
    ref: m.id,
    conversationRef: m.chatId,
    text: m.text ?? "",
    sentAtMs: m.createdAt.getTime(),
    isFromMe: m.isFromMe,
    isGroup: m.chatKind === "group",
    participantHandles: m.participant === null ? [] : [m.participant],
  };
};

export interface PhotonProviderOptions {
  onError?: (error: Error) => void;
}

export class PhotonProvider implements ImessageProvider {
  private client: ImessageKitSdk | undefined;
  private readonly listeners = new Set<(msg: LocalMessage) => void>();
  private readonly options: PhotonProviderOptions;
  private started = false;

  constructor(options: PhotonProviderOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.started) return;
    // the local platform's createClient ignores its context entirely
    // (`createClient: async () => new IMessageSDK()`), so a stub is safe.
    const definition = imessage.config({}).__definition;
    const client = (await definition.lifecycle.createClient({
      config: {},
      store: undefined,
    })) as ImessageKitSdk;
    this.client = client;
    const dispatch = (message: KitMessage): void => {
      const local = toLocalMessage(message);
      if (local === undefined) return;
      for (const listener of this.listeners) listener(local);
    };
    await client.startWatching({
      onIncomingMessage: dispatch,
      onFromMeMessage: dispatch,
      onError: (error) => this.options.onError?.(error),
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.started = false;
    if (client === undefined) return;
    await client.stopWatching().catch(() => undefined);
    await client.close().catch(() => undefined);
  }

  onMessage(cb: (msg: LocalMessage) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async sendMessage(conversationRef: string, text: string): Promise<SendResult> {
    const client = this.requireClient();
    const sentAtMs = Date.now();
    try {
      // kit `send` resolves on AppleScript acceptance, not delivery; the
      // chat.db row (localMessageRef) is observed later via the watcher.
      await client.send({ to: conversationRef, text });
      return { ok: true, sentAtMs };
    } catch (error) {
      return {
        ok: false,
        sentAtMs,
        errorCode: "send_failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async getRecentMessages(conversationRef: string, limit: number, sinceMs: number): Promise<LocalMessage[]> {
    const client = this.requireClient();
    const rows = await client.getMessages({
      chatId: conversationRef,
      since: new Date(sinceMs),
      excludeReactions: true,
      // over-fetch slightly: some rows may be non-text / unroutable.
      limit: Math.max(limit * 2, limit + 5),
    });
    const mapped: LocalMessage[] = [];
    for (const row of rows) {
      const local = toLocalMessage(row);
      if (local !== undefined && local.sentAtMs >= sinceMs) mapped.push(local);
    }
    mapped.sort((a, b) => a.sentAtMs - b.sentAtMs);
    return mapped.slice(-limit);
  }

  private requireClient(): ImessageKitSdk {
    if (this.client === undefined) throw new Error("photon provider not started");
    return this.client;
  }
}
