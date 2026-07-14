import { SOCKET_EVENTS, ackSchema, type CloudCommand } from "@soon/realtime-protocol";
import type { Logger } from "@soon/observability";
import { AbortRetryError, withBackoff } from "./retry.js";
import type { CommandStore } from "./store.js";

/** structural subset of a socket.io socket the dispatcher needs — trivial to mock */
export interface DeviceSocketLike {
  timeout(ms: number): {
    emitWithAck(event: string, payload: unknown): Promise<unknown>;
  };
}

export interface CommandDispatcherOptions {
  store: CommandStore;
  logger: Logger;
  /** resolve the target device's active socket (undefined = offline) */
  getSocket: (deviceId: string) => DeviceSocketLike | undefined;
  /** socket.io ack timeout per attempt (default 5s) */
  ackTimeoutMs?: number;
  /** total attempts including the first (default 3) */
  attempts?: number;
  baseDelayMs?: number;
  /** injectable clock and sleep for tests */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export interface CommandDispatcher {
  /**
   * dispatch a stored command to its device with retries and backoff.
   * lifecycle: created → dispatched (emit attempted) → delivered (socket ack
   * received) → acknowledged (device accepted, ack.ok). terminal failures:
   * `expired` (expiry is checked before every attempt — an expired command is
   * never sent) and `failed` (device rejected, or retries exhausted).
   */
  dispatch(command: CloudCommand): Promise<void>;
}

export function createCommandDispatcher(options: CommandDispatcherOptions): CommandDispatcher {
  const {
    store,
    logger,
    getSocket,
    ackTimeoutMs = 5_000,
    attempts = 3,
    baseDelayMs = 250,
    now = () => new Date(),
  } = options;

  async function attemptOnce(command: CloudCommand, attempt: number): Promise<void> {
    // expiry is checked before EVERY attempt — never send an expired command
    if (Date.parse(command.expiresAt) <= now().getTime()) {
      throw new AbortRetryError("command expired before dispatch", "expired");
    }
    const socket = getSocket(command.deviceId);
    if (!socket) {
      throw new Error("device offline");
    }
    await store.recordDispatchAttempt(command.commandId);
    await store.setCommandStatus(command.commandId, "dispatched");
    logger.info({ commandId: command.commandId, attempt, type: command.type }, "command dispatched");
    const rawAck = await socket.timeout(ackTimeoutMs).emitWithAck(SOCKET_EVENTS.command, command);
    const ack = ackSchema.safeParse(rawAck);
    if (!ack.success) {
      throw new Error("device returned a malformed ack");
    }
    await store.setCommandStatus(command.commandId, "delivered");
    if (!ack.data.ok) {
      throw new AbortRetryError(
        `device rejected command: ${ack.data.errorCode ?? "unknown"}`,
        ack.data.errorCode ?? "device_rejected",
      );
    }
    await store.setCommandStatus(command.commandId, "acknowledged");
    logger.info({ commandId: command.commandId }, "command acknowledged");
  }

  return {
    async dispatch(command: CloudCommand): Promise<void> {
      try {
        await withBackoff((attempt) => attemptOnce(command, attempt), {
          attempts,
          baseDelayMs,
          shouldRetry: (error) => !(error instanceof AbortRetryError),
          ...(options.sleep ? { sleep: options.sleep } : {}),
          onRetry: (error, attempt, delayMs) => {
            logger.warn(
              {
                commandId: command.commandId,
                attempt,
                delayMs,
                reason: error instanceof Error ? error.message : "unknown",
              },
              "command dispatch retrying",
            );
          },
        });
      } catch (error) {
        if (error instanceof AbortRetryError && error.code === "expired") {
          await store.setCommandStatus(command.commandId, "expired", "expired");
          logger.warn({ commandId: command.commandId }, "command expired, not sent");
          return;
        }
        const code =
          error instanceof AbortRetryError ? error.code : "dispatch_exhausted";
        await store.setCommandStatus(command.commandId, "failed", code);
        logger.error(
          { commandId: command.commandId, errorCode: code },
          "command dispatch failed",
        );
      }
    },
  };
}
