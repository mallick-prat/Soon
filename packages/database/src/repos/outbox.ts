import { getDb } from "../client.js";
import type { OutboxCommand, Prisma } from "../generated/prisma/client.js";
import { OutboxStatus } from "../generated/prisma/enums.js";

export interface EnqueueOutboxCommandInput {
  userId: string;
  commandType: string;
  payloadJson: Prisma.InputJsonValue;
  idempotencyKey: string;
  deviceId?: string;
  sessionId?: string;
  expiresAt?: Date;
}

/**
 * enqueues a command for the mac agent. idempotent: re-enqueueing the same
 * idempotency key returns the existing row untouched.
 */
export async function enqueueOutboxCommand(
  input: EnqueueOutboxCommandInput,
): Promise<OutboxCommand> {
  const db = getDb();
  return db.outboxCommand.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      userId: input.userId,
      commandType: input.commandType,
      payloadJson: input.payloadJson,
      idempotencyKey: input.idempotencyKey,
      ...(input.deviceId !== undefined && { deviceId: input.deviceId }),
      ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
      ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
    },
  });
}

/** forward-only status ordering; a command never moves backwards */
const STATUS_ORDER: Record<OutboxStatus, number> = {
  pending: 0,
  dispatched: 1,
  delivered: 2,
  acknowledged: 3,
  expired: 4,
  failed: 4,
  cancelled: 4,
};

const STATUS_TIMESTAMP_FIELD: Partial<
  Record<OutboxStatus, keyof Prisma.OutboxCommandUpdateInput>
> = {
  dispatched: "dispatchedAt",
  delivered: "deliveredAt",
  acknowledged: "acknowledgedAt",
  failed: "failedAt",
};

export interface AdvanceOutboxResult {
  advanced: boolean;
  command: OutboxCommand;
}

/**
 * advances a command's status, stamping the matching timestamp column.
 * refuses to move backwards (e.g. acknowledged → dispatched) and reports
 * whether anything changed.
 */
export async function advanceOutboxStatus(
  idempotencyKey: string,
  toStatus: OutboxStatus,
  errorCode?: string,
): Promise<AdvanceOutboxResult> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    const existing = await tx.outboxCommand.findUniqueOrThrow({
      where: { idempotencyKey },
    });
    if (STATUS_ORDER[toStatus] <= STATUS_ORDER[existing.status]) {
      return { advanced: false, command: existing };
    }
    const timestampField = STATUS_TIMESTAMP_FIELD[toStatus];
    const command = await tx.outboxCommand.update({
      where: { idempotencyKey },
      data: {
        status: toStatus,
        ...(timestampField !== undefined && { [timestampField]: new Date() }),
        ...(errorCode !== undefined && { errorCode }),
      },
    });
    return { advanced: true, command };
  });
}

/** next batch of pending commands for a device, in sequence order */
export async function nextPendingCommands(
  userId: string,
  limit = 20,
): Promise<OutboxCommand[]> {
  const db = getDb();
  return db.outboxCommand.findMany({
    where: {
      userId,
      status: OutboxStatus.pending,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { sequenceNumber: "asc" },
    take: limit,
  });
}

/**
 * next batch of unexpired pending commands across ALL users, in global
 * sequence order — the drainer's fetch. per-user fairness is out of scope for
 * the single-primary-user v1; revisit with a per-user round-robin at scale.
 */
export async function pendingCommandsAcrossUsers(limit = 50): Promise<OutboxCommand[]> {
  const db = getDb();
  return db.outboxCommand.findMany({
    where: {
      status: OutboxStatus.pending,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { sequenceNumber: "asc" },
    take: limit,
  });
}

/** records an inbound receipt from the mac agent, idempotently */
export async function recordInboxReceipt(input: {
  userId: string;
  receiptType: string;
  idempotencyKey: string;
  deviceId?: string;
  sessionId?: string;
  payloadJson?: Prisma.InputJsonValue;
}) {
  const db = getDb();
  return db.inboxReceipt.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      userId: input.userId,
      receiptType: input.receiptType,
      idempotencyKey: input.idempotencyKey,
      ...(input.deviceId !== undefined && { deviceId: input.deviceId }),
      ...(input.sessionId !== undefined && { sessionId: input.sessionId }),
      ...(input.payloadJson !== undefined && { payloadJson: input.payloadJson }),
    },
  });
}
