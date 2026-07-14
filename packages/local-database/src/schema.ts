import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * mac-side sqlite schema (drizzle). the mac app owns migrations; this package
 * exports the canonical table shapes so tooling and future surfaces agree.
 */

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** last processed message per conversation — the resume cursor */
export const cursors = sqliteTable("cursors", {
  conversationReference: text("conversation_reference").primaryKey(),
  lastMessageReference: text("last_message_reference").notNull(),
  lastMessageAt: integer("last_message_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** inbound dedupe: one row per processed local message */
export const inboxReceipts = sqliteTable(
  "inbox_receipts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    localMessageReference: text("local_message_reference").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: integer("received_at").notNull(),
    processedAt: integer("processed_at"),
    status: text("status").notNull().default("received"),
  },
  (t) => [uniqueIndex("inbox_receipts_ref_idx").on(t.localMessageReference)],
);

/** outbox for approved-but-unsent actions; payload encrypted via safeStorage */
export const pendingActions = sqliteTable(
  "pending_actions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    commandId: text("command_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    conversationReference: text("conversation_reference").notNull(),
    payloadEncrypted: text("payload_encrypted").notNull(),
    status: text("status").notNull().default("queued"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
    executedAt: integer("executed_at"),
    acknowledgedAt: integer("acknowledged_at"),
    failureCode: text("failure_code"),
  },
  (t) => [uniqueIndex("pending_actions_idem_idx").on(t.idempotencyKey)],
);
