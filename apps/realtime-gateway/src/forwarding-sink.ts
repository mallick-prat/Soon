import type { Logger } from "@soon/observability";
import type { DeviceEvent } from "@soon/realtime-protocol";

import type { EventSink } from "./store.js";

export interface ForwardingEventSinkConfig {
  /** worker device-event ingress, e.g. http://localhost:8788/internal/device-events */
  url: string;
  /** shared bearer token the worker checks (INTERNAL_API_TOKEN) */
  internalToken: string;
  logger?: Logger;
  /** override for tests */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * an EventSink that forwards each validated device event to the worker over an
 * internal HTTP hop. forwarding is best-effort and non-blocking: a slow or
 * failing worker must never wedge the gateway's device-event path, so failures
 * are logged and swallowed (the device already got its ack). the gateway has
 * verified the envelope signature + sequence before this runs.
 */
export function createForwardingEventSink(config: ForwardingEventSinkConfig): EventSink {
  const doFetch = config.fetchImpl ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;

  return {
    async handleDeviceEvent(event: DeviceEvent): Promise<void> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await doFetch(config.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.internalToken}`,
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
        if (!res.ok) {
          config.logger?.warn(
            { status: res.status, type: event.type, deviceId: event.deviceId },
            "worker rejected forwarded device event",
          );
        }
      } catch (error) {
        config.logger?.warn(
          { reason: error instanceof Error ? error.message : "unknown", type: event.type },
          "failed to forward device event to worker",
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
