import { deviceEventSchema, type Ack } from "@soon/realtime-protocol";
import type { Logger } from "@soon/observability";
import type { CommandStore, EventSink } from "./store.js";

export interface HandleDeviceEventDeps {
  store: CommandStore;
  sink: EventSink;
  logger: Logger;
  /** deviceId proven by the socket's jwt — events must match it */
  authenticatedDeviceId: string;
}

function eventIdOf(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "eventId" in raw) {
    const id = (raw as { eventId: unknown }).eventId;
    if (typeof id === "string") return id;
  }
  return "unknown";
}

/**
 * validate + gate an inbound `soon:device-event` and return the ack to send.
 * pure of socket.io so it can be unit-tested directly.
 */
export async function handleDeviceEvent(raw: unknown, deps: HandleDeviceEventDeps): Promise<Ack> {
  const { store, sink, logger, authenticatedDeviceId } = deps;
  const parsed = deviceEventSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ deviceId: authenticatedDeviceId }, "rejected malformed device event");
    return { ok: false, id: eventIdOf(raw), errorCode: "invalid_event" };
  }
  const event = parsed.data;
  if (event.deviceId !== authenticatedDeviceId) {
    logger.warn(
      { deviceId: authenticatedDeviceId, eventId: event.eventId },
      "rejected device event with mismatched deviceId",
    );
    return { ok: false, id: event.eventId, errorCode: "device_mismatch" };
  }
  const verdict = await store.registerDeviceEvent({
    deviceId: event.deviceId,
    sequenceNumber: event.sequenceNumber,
    idempotencyKey: event.idempotencyKey,
  });
  if (verdict === "duplicate") {
    // safe retransmit — ack ok so the device stops retrying, but do not re-forward
    logger.info({ deviceId: event.deviceId, eventId: event.eventId }, "duplicate device event acked");
    return { ok: true, id: event.eventId };
  }
  if (verdict === "stale") {
    logger.warn(
      { deviceId: event.deviceId, eventId: event.eventId, sequenceNumber: event.sequenceNumber },
      "rejected stale device event sequence",
    );
    return { ok: false, id: event.eventId, errorCode: "stale_sequence" };
  }
  try {
    await sink.handleDeviceEvent(event);
  } catch (error) {
    logger.error(
      { deviceId: event.deviceId, eventId: event.eventId, reason: error instanceof Error ? error.message : "unknown" },
      "event sink failed",
    );
    return { ok: false, id: event.eventId, errorCode: "sink_error" };
  }
  logger.info(
    { deviceId: event.deviceId, eventId: event.eventId, eventType: event.type },
    "device event accepted",
  );
  return { ok: true, id: event.eventId };
}
