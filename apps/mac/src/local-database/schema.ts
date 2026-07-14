/**
 * local drizzle schema (self-contained inside apps/mac — do not import
 * @soon/local-database, it is built concurrently by another agent).
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** last processed message per conversation + conversation-level flags. */
export const cursors = sqliteTable("cursors", {
  conversationRef: text("conversation_ref").primaryKey(),
  lastMessageRef: text("last_message_ref"),
  lastMessageAtMs: integer("last_message_at_ms").notNull().default(0),
  blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
  paused: integer("paused", { mode: "boolean" }).notNull().default(false),
  activeSessionId: text("active_session_id"),
});

/** processed-input receipts — dedupe for messages and cloud commands. */
export const inboxReceipts = sqliteTable("inbox_receipts", {
  localMessageReference: text("local_message_reference").primaryKey(),
  payloadHash: text("payload_hash").notNull(),
  processedAt: integer("processed_at_ms").notNull(),
});

export const PENDING_ACTION_STATUSES = [
  "pending",
  "sending",
  "sent",
  "failed",
  "expired",
  "cancelled",
] as const;
export type PendingActionStatus = (typeof PENDING_ACTION_STATUSES)[number];

/** outbox for approved-but-unsent messages (payload encrypted at rest). */
export const pendingActions = sqliteTable("pending_actions", {
  id: text("id").primaryKey(),
  commandId: text("command_id"),
  conversationRef: text("conversation_ref"),
  encryptedPayload: text("encrypted_payload").notNull(),
  expiresAtMs: integer("expires_at_ms").notNull(),
  status: text("status").$type<PendingActionStatus>().notNull().default("pending"),
  createdAtMs: integer("created_at_ms").notNull(),
  sentAtMs: integer("sent_at_ms"),
  localMessageRef: text("local_message_ref"),
  lastError: text("last_error"),
});

/** single-row app settings (id is always 1). */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  installedAtMs: integer("installed_at_ms").notNull(),
  deviceId: text("device_id").notNull(),
  triggerEmoji: text("trigger_emoji").notNull(),
  /** highest cloud command sequence number accepted so far. */
  lastInboundSequence: integer("last_inbound_sequence").notNull().default(-1),
  /** last device event sequence number emitted. */
  lastOutboundSequence: integer("last_outbound_sequence").notNull().default(-1),
  /** encrypted device jwt, when provisioned. */
  deviceTokenEnc: text("device_token_enc"),
});

/** hand-written ddl kept in lockstep with the tables above. */
export const DDL = `
CREATE TABLE IF NOT EXISTS cursors (
  conversation_ref TEXT PRIMARY KEY,
  last_message_ref TEXT,
  last_message_at_ms INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  active_session_id TEXT
);
CREATE TABLE IF NOT EXISTS inbox_receipts (
  local_message_reference TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  processed_at_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_actions (
  id TEXT PRIMARY KEY,
  command_id TEXT,
  conversation_ref TEXT,
  encrypted_payload TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER,
  local_message_ref TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pending_actions_status ON pending_actions (status, expires_at_ms);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY,
  installed_at_ms INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  trigger_emoji TEXT NOT NULL,
  last_inbound_sequence INTEGER NOT NULL DEFAULT -1,
  last_outbound_sequence INTEGER NOT NULL DEFAULT -1,
  device_token_enc TEXT
);
`;
