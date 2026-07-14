/**
 * outbox drainer — the relay that makes the whole command loop fire.
 *
 * reads pending rows from outbox_commands, builds each into a signed
 * CloudCommand envelope, and POSTs it to the gateway's /internal/commands.
 * the gateway relays to the device socket; this drainer only advances the
 * outbox row's status (dispatched / failed). transient POST failures leave the
 * row pending for the next pass.
 *
 * every transport dependency (db fetch, device resolution, http, status
 * advance) is injectable so the relay logic is unit-testable without a db,
 * a gateway, or a network.
 */
import { cloudCommandSchema, PROTOCOL_VERSION, type CloudCommand } from "@soon/realtime-protocol";
import { signEnvelope } from "@soon/security";
import {
  advanceOutboxStatus,
  getDb,
  pendingCommandsAcrossUsers,
  type OutboxCommand,
} from "@soon/database";
import type { Logger } from "@soon/observability";

export type OutboxStatusUpdate = "dispatched" | "failed";

export interface OutboxDrainerConfig {
  gatewayUrl: string;
  internalToken: string;
  /** shared secret the gateway verifies command signatures with (DEVICE_SIGNING_SECRET) */
  signingSecret: string;
  /** fallback expiry when a row has none (default 15 min) */
  defaultTtlMs?: number;
  batchSize?: number;
  logger?: Logger;
  now?: () => Date;
  // ---- injectable transport seams (default to the real db / http) ----
  fetchPending?: (limit: number) => Promise<OutboxCommand[]>;
  resolveDeviceId?: (row: OutboxCommand) => Promise<string | null>;
  advanceStatus?: (idempotencyKey: string, status: OutboxStatusUpdate, errorCode?: string) => Promise<void>;
  post?: (url: string, token: string, body: unknown) => Promise<{ status: number }>;
}

export interface DrainResult {
  dispatched: number;
  failed: number;
  /** rows with no target device or a malformed payload — marked failed */
  skipped: number;
}

const DEFAULT_TTL_MS = 15 * 60_000;

/** resolve the device to send to: the row's device, else the user's most-recently-seen mac. */
async function defaultResolveDeviceId(row: OutboxCommand): Promise<string | null> {
  if (row.deviceId !== null) return row.deviceId;
  const device = await getDb().macDevice.findFirst({
    where: { userId: row.userId },
    orderBy: { lastSeenAt: "desc" },
  });
  return device?.id ?? null;
}

async function defaultPost(url: string, token: string, body: unknown): Promise<{ status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status };
}

export interface OutboxDrainer {
  /** relay one batch; returns per-outcome counts. safe to call on an interval. */
  drainOnce(): Promise<DrainResult>;
  /** build (and sign) the CloudCommand for a row, or null if undispatchable. */
  buildCommand(row: OutboxCommand): Promise<CloudCommand | null>;
}

export function createOutboxDrainer(config: OutboxDrainerConfig): OutboxDrainer {
  const now = config.now ?? (() => new Date());
  const ttl = config.defaultTtlMs ?? DEFAULT_TTL_MS;
  const batchSize = config.batchSize ?? 50;
  const fetchPending = config.fetchPending ?? pendingCommandsAcrossUsers;
  const resolveDeviceId = config.resolveDeviceId ?? defaultResolveDeviceId;
  const post = config.post ?? defaultPost;
  const advance =
    config.advanceStatus ??
    (async (key: string, status: OutboxStatusUpdate, errorCode?: string) => {
      await advanceOutboxStatus(key, status, errorCode);
    });
  const log = config.logger;

  async function buildCommand(row: OutboxCommand): Promise<CloudCommand | null> {
    const deviceId = await resolveDeviceId(row);
    if (deviceId === null) return null;

    const issuedAt = now().toISOString();
    const expiresAt = (row.expiresAt ?? new Date(now().getTime() + ttl)).toISOString();

    // parse first with a placeholder signature, then sign over the PARSED
    // object — so the gateway's re-parse yields an identical canonical form
    // and the signature always verifies (zod defaults can't shift it).
    const candidate = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: row.id,
      deviceId,
      ...(row.sessionId !== null ? { sessionId: row.sessionId } : {}),
      sequenceNumber: Number(row.sequenceNumber),
      issuedAt,
      expiresAt,
      idempotencyKey: row.idempotencyKey,
      signature: "",
      type: row.commandType,
      payload: row.payloadJson,
    };
    const parsed = cloudCommandSchema.safeParse(candidate);
    if (!parsed.success) {
      log?.error({ commandId: row.id, type: row.commandType }, "outbox row failed protocol validation");
      return null;
    }
    const signature = signEnvelope(parsed.data as unknown as Record<string, unknown>, config.signingSecret);
    return { ...parsed.data, signature };
  }

  async function drainOnce(): Promise<DrainResult> {
    const rows = await fetchPending(batchSize);
    const result: DrainResult = { dispatched: 0, failed: 0, skipped: 0 };

    for (const row of rows) {
      const command = await buildCommand(row);
      if (command === null) {
        // undispatchable (no device / bad payload) — fail it so it stops
        // blocking the ordered queue; the producer can re-enqueue.
        await advance(row.idempotencyKey, "failed", "undispatchable");
        result.skipped += 1;
        continue;
      }
      try {
        const res = await post(`${config.gatewayUrl}/internal/commands`, config.internalToken, command);
        if (res.status === 200 || res.status === 202) {
          await advance(row.idempotencyKey, "dispatched");
          result.dispatched += 1;
        } else {
          await advance(row.idempotencyKey, "failed", `gateway_${res.status}`);
          result.failed += 1;
          log?.warn({ commandId: row.id, status: res.status }, "gateway rejected command");
        }
      } catch (error) {
        // transient (network) failure — leave the row pending for retry.
        result.failed += 1;
        log?.warn(
          { commandId: row.id, reason: error instanceof Error ? error.message : "unknown" },
          "gateway post failed; leaving pending for retry",
        );
      }
    }
    return result;
  }

  return { drainOnce, buildCommand };
}
