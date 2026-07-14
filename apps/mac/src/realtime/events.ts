/** device event construction — every outbound event is schema-validated. */
import { randomUUID } from "node:crypto";

import { PROTOCOL_VERSION, deviceEventSchema, type DeviceEvent } from "@soon/realtime-protocol";

type EventOf<T extends DeviceEvent["type"]> = Extract<DeviceEvent, { type: T }>;
export type DeviceEventPayload<T extends DeviceEvent["type"]> = EventOf<T>["payload"];

export interface DeviceEventFactoryOptions {
  deviceId: string;
  nextSequence: () => number;
  now?: () => number;
}

export class DeviceEventFactory {
  private readonly deviceId: string;
  private readonly nextSequence: () => number;
  private readonly now: () => number;

  constructor(options: DeviceEventFactoryOptions) {
    this.deviceId = options.deviceId;
    this.nextSequence = options.nextSequence;
    this.now = options.now ?? (() => Date.now());
  }

  build<T extends DeviceEvent["type"]>(
    type: T,
    payload: DeviceEventPayload<T>,
    sessionId?: string,
  ): DeviceEvent {
    const eventId = randomUUID();
    const candidate = {
      protocolVersion: PROTOCOL_VERSION,
      eventId,
      deviceId: this.deviceId,
      ...(sessionId !== undefined ? { sessionId } : {}),
      sequenceNumber: this.nextSequence(),
      occurredAt: new Date(this.now()).toISOString(),
      idempotencyKey: eventId,
      type,
      payload,
    };
    return deviceEventSchema.parse(candidate);
  }
}
