/** typed repositories over the local database. */
import { createHash, randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";

import { DEFAULT_TRIGGER_EMOJI } from "../imessage/trigger.js";
import type { SecretBox } from "../secure-storage/index.js";
import type { LocalDb } from "./db.js";
import { cursors, inboxReceipts, pendingActions, settings, type PendingActionStatus } from "./schema.js";

export const sha256 = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

/* ------------------------------------------------------------------ cursor */

export interface ConversationCursor {
  conversationRef: string;
  lastMessageRef: string | null;
  lastMessageAtMs: number;
  blocked: boolean;
  paused: boolean;
  activeSessionId: string | null;
}

const EMPTY_CURSOR = (conversationRef: string): ConversationCursor => ({
  conversationRef,
  lastMessageRef: null,
  lastMessageAtMs: 0,
  blocked: false,
  paused: false,
  activeSessionId: null,
});

export class CursorStore {
  constructor(private readonly db: LocalDb) {}

  get(conversationRef: string): ConversationCursor {
    const row = this.db.select().from(cursors).where(eq(cursors.conversationRef, conversationRef)).get();
    return row ?? EMPTY_CURSOR(conversationRef);
  }

  all(): ConversationCursor[] {
    return this.db.select().from(cursors).all();
  }

  /** advance the cursor; older or equal timestamps are ignored (monotonic). */
  advance(conversationRef: string, messageRef: string, atMs: number): boolean {
    const current = this.get(conversationRef);
    if (atMs <= current.lastMessageAtMs) return false;
    this.upsert({ ...current, lastMessageRef: messageRef, lastMessageAtMs: atMs });
    return true;
  }

  setBlocked(conversationRef: string, blocked: boolean): void {
    this.upsert({ ...this.get(conversationRef), blocked });
  }

  setPaused(conversationRef: string, paused: boolean): void {
    this.upsert({ ...this.get(conversationRef), paused });
  }

  setActiveSession(conversationRef: string, sessionId: string | null): void {
    this.upsert({ ...this.get(conversationRef), activeSessionId: sessionId });
  }

  private upsert(cursor: ConversationCursor): void {
    this.db
      .insert(cursors)
      .values(cursor)
      .onConflictDoUpdate({
        target: cursors.conversationRef,
        set: {
          lastMessageRef: cursor.lastMessageRef,
          lastMessageAtMs: cursor.lastMessageAtMs,
          blocked: cursor.blocked,
          paused: cursor.paused,
          activeSessionId: cursor.activeSessionId,
        },
      })
      .run();
  }
}

/* ---------------------------------------------------------------- receipts */

export class ReceiptStore {
  constructor(private readonly db: LocalDb) {}

  /**
   * record a processed input. returns true the first time, false when the
   * reference was already processed (duplicate — skip it).
   */
  recordIfNew(reference: string, payload: string, nowMs: number): boolean {
    const result = this.db
      .insert(inboxReceipts)
      .values({ localMessageReference: reference, payloadHash: sha256(payload), processedAt: nowMs })
      .onConflictDoNothing()
      .run();
    return result.changes > 0;
  }

  has(reference: string): boolean {
    return (
      this.db
        .select({ ref: inboxReceipts.localMessageReference })
        .from(inboxReceipts)
        .where(eq(inboxReceipts.localMessageReference, reference))
        .get() !== undefined
    );
  }
}

/* ---------------------------------------------------------- pending actions */

export interface PendingActionRow {
  id: string;
  commandId: string | null;
  conversationRef: string | null;
  expiresAtMs: number;
  status: PendingActionStatus;
  createdAtMs: number;
  sentAtMs: number | null;
  localMessageRef: string | null;
  lastError: string | null;
}

export interface AcquiredAction<TPayload = unknown> extends PendingActionRow {
  payload: TPayload;
}

export class PendingActionStore {
  constructor(
    private readonly db: LocalDb,
    private readonly box: SecretBox,
  ) {}

  create(input: {
    id?: string;
    commandId?: string;
    conversationRef?: string;
    payload: unknown;
    expiresAtMs: number;
    nowMs: number;
  }): string {
    const id = input.id ?? randomUUID();
    this.db
      .insert(pendingActions)
      .values({
        id,
        commandId: input.commandId ?? null,
        conversationRef: input.conversationRef ?? null,
        encryptedPayload: this.box.encryptString(JSON.stringify(input.payload)),
        expiresAtMs: input.expiresAtMs,
        status: "pending",
        createdAtMs: input.nowMs,
      })
      .run();
    return id;
  }

  /**
   * atomically claim a pending action for sending. returns the decrypted
   * payload, or undefined when the action is missing, expired, or already
   * claimed by someone else.
   */
  acquire<TPayload = unknown>(id: string, nowMs: number): AcquiredAction<TPayload> | undefined {
    const claimed = this.db
      .update(pendingActions)
      .set({ status: "sending" })
      .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "pending")))
      .run();
    if (claimed.changes === 0) return undefined;
    const row = this.getRow(id);
    if (row === undefined) return undefined;
    if (row.expiresAtMs <= nowMs) {
      this.db.update(pendingActions).set({ status: "expired" }).where(eq(pendingActions.id, id)).run();
      return undefined;
    }
    const raw = this.db
      .select({ encryptedPayload: pendingActions.encryptedPayload })
      .from(pendingActions)
      .where(eq(pendingActions.id, id))
      .get();
    if (raw === undefined) return undefined;
    return { ...row, status: "sending", payload: JSON.parse(this.box.decryptString(raw.encryptedPayload)) as TPayload };
  }

  markSent(id: string, atMs: number, localMessageRef?: string): void {
    this.db
      .update(pendingActions)
      .set({ status: "sent", sentAtMs: atMs, localMessageRef: localMessageRef ?? null })
      .where(eq(pendingActions.id, id))
      .run();
  }

  markFailed(id: string, error: string): void {
    this.db.update(pendingActions).set({ status: "failed", lastError: error }).where(eq(pendingActions.id, id)).run();
  }

  cancelByCommandId(commandId: string): number {
    const result = this.db
      .update(pendingActions)
      .set({ status: "cancelled" })
      .where(and(eq(pendingActions.commandId, commandId), eq(pendingActions.status, "pending")))
      .run();
    return result.changes;
  }

  /** mark every overdue pending action expired; returns how many changed. */
  expireDue(nowMs: number): number {
    const result = this.db
      .update(pendingActions)
      .set({ status: "expired" })
      .where(and(eq(pendingActions.status, "pending"), lt(pendingActions.expiresAtMs, nowMs)))
      .run();
    return result.changes;
  }

  getRow(id: string): PendingActionRow | undefined {
    const row = this.db
      .select({
        id: pendingActions.id,
        commandId: pendingActions.commandId,
        conversationRef: pendingActions.conversationRef,
        expiresAtMs: pendingActions.expiresAtMs,
        status: pendingActions.status,
        createdAtMs: pendingActions.createdAtMs,
        sentAtMs: pendingActions.sentAtMs,
        localMessageRef: pendingActions.localMessageRef,
        lastError: pendingActions.lastError,
      })
      .from(pendingActions)
      .where(eq(pendingActions.id, id))
      .get();
    return row;
  }
}

/* ---------------------------------------------------------------- settings */

export interface AppSettings {
  installedAtMs: number;
  deviceId: string;
  triggerEmoji: string;
  lastInboundSequence: number;
  lastOutboundSequence: number;
  deviceTokenEnc: string | null;
  deviceTokenExpiresAtMs: number | null;
  devicePrivateKeyEnc: string | null;
  devicePublicKey: string | null;
  serverDeviceId: string | null;
}

const SETTINGS_ID = 1;

export class SettingsStore {
  constructor(private readonly db: LocalDb) {}

  /** idempotent: creates the single settings row on first run. */
  init(nowMs: number): AppSettings {
    const existing = this.tryGet();
    if (existing !== undefined) return existing;
    this.db
      .insert(settings)
      .values({
        id: SETTINGS_ID,
        installedAtMs: nowMs,
        deviceId: randomUUID(),
        triggerEmoji: DEFAULT_TRIGGER_EMOJI,
      })
      .onConflictDoNothing()
      .run();
    const created = this.tryGet();
    if (created === undefined) throw new Error("failed to initialize settings");
    return created;
  }

  get(): AppSettings {
    const row = this.tryGet();
    if (row === undefined) throw new Error("settings not initialized");
    return row;
  }

  setTriggerEmoji(triggerEmoji: string): void {
    this.db.update(settings).set({ triggerEmoji }).where(eq(settings.id, SETTINGS_ID)).run();
  }

  setDeviceTokenEnc(deviceTokenEnc: string | null): void {
    this.db.update(settings).set({ deviceTokenEnc }).where(eq(settings.id, SETTINGS_ID)).run();
  }

  /** persist the ed25519 device keypair (private key already encrypted). */
  setDeviceKeypair(devicePrivateKeyEnc: string, devicePublicKey: string): void {
    this.db
      .update(settings)
      .set({ devicePrivateKeyEnc, devicePublicKey })
      .where(eq(settings.id, SETTINGS_ID))
      .run();
  }

  /**
   * record the server-assigned device id. also overwrites deviceId so device
   * events carry the id the gateway authenticates + routes on (they must match).
   */
  setServerDeviceId(serverDeviceId: string): void {
    this.db
      .update(settings)
      .set({ serverDeviceId, deviceId: serverDeviceId })
      .where(eq(settings.id, SETTINGS_ID))
      .run();
  }

  /** persist the gateway access token and its expiry (encrypted token). */
  setAccessToken(deviceTokenEnc: string, deviceTokenExpiresAtMs: number): void {
    this.db
      .update(settings)
      .set({ deviceTokenEnc, deviceTokenExpiresAtMs })
      .where(eq(settings.id, SETTINGS_ID))
      .run();
  }

  /**
   * accept an inbound sequence number if it is strictly greater than the
   * last accepted one; returns false on regression/replay.
   */
  acceptInboundSequence(sequenceNumber: number): boolean {
    const current = this.get();
    if (sequenceNumber <= current.lastInboundSequence) return false;
    this.db
      .update(settings)
      .set({ lastInboundSequence: sequenceNumber })
      .where(eq(settings.id, SETTINGS_ID))
      .run();
    return true;
  }

  nextOutboundSequence(): number {
    const next = this.get().lastOutboundSequence + 1;
    this.db.update(settings).set({ lastOutboundSequence: next }).where(eq(settings.id, SETTINGS_ID)).run();
    return next;
  }

  private tryGet(): AppSettings | undefined {
    const row = this.db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
    if (row === undefined) return undefined;
    const { id: _id, ...rest } = row;
    return rest;
  }
}
