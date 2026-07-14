import type { CloudCommand, CommandStatus, DeviceEvent } from "@soon/realtime-protocol";

export interface StoredCommand {
  command: CloudCommand;
  status: CommandStatus;
  attempts: number;
  /** iso instant of the last status change */
  updatedAt: string;
  lastErrorCode?: string;
}

export type DeviceEventVerdict = "accepted" | "duplicate" | "stale";

/**
 * persistence seam for the gateway. the in-memory implementation below is for
 * dev/tests; a postgres adapter lands later backed by the outbox_commands
 * table (commands + lifecycle) and a device_event_cursor table
 * (deviceId → last sequenceNumber, plus an idempotency-key unique index) —
 * registerDeviceEvent maps onto a single transactional insert there.
 */
export interface CommandStore {
  /** persist a new command in `created` state. throws on duplicate commandId. */
  saveCommand(command: CloudCommand): Promise<void>;
  getCommand(commandId: string): Promise<StoredCommand | undefined>;
  /** look up a previously accepted command by idempotency key */
  findCommandByIdempotencyKey(key: string): Promise<StoredCommand | undefined>;
  setCommandStatus(commandId: string, status: CommandStatus, errorCode?: string): Promise<void>;
  /** increment and return the attempt counter for a command */
  recordDispatchAttempt(commandId: string): Promise<number>;
  /**
   * atomically validate an inbound device event:
   * - `duplicate` if the idempotency key was already seen for this device
   *   (safe retransmit — ack ok, do not re-forward)
   * - `stale` if sequenceNumber is not strictly greater than the last
   *   accepted sequence for this device
   * - `accepted` otherwise; records both the sequence and the idempotency key
   */
  registerDeviceEvent(input: {
    deviceId: string;
    sequenceNumber: number;
    idempotencyKey: string;
  }): Promise<DeviceEventVerdict>;
  lastEventSequence(deviceId: string): Promise<number | undefined>;
}

/** downstream consumer of validated device events (web/worker backend later) */
export interface EventSink {
  handleDeviceEvent(event: DeviceEvent): Promise<void>;
}

export class InMemoryCommandStore implements CommandStore {
  private commands = new Map<string, StoredCommand>();
  private commandIdByIdempotencyKey = new Map<string, string>();
  private eventSequences = new Map<string, number>();
  private seenEventKeys = new Set<string>();

  async saveCommand(command: CloudCommand): Promise<void> {
    if (this.commands.has(command.commandId)) {
      throw new Error(`command ${command.commandId} already exists`);
    }
    this.commands.set(command.commandId, {
      command,
      status: "created",
      attempts: 0,
      updatedAt: new Date().toISOString(),
    });
    this.commandIdByIdempotencyKey.set(command.idempotencyKey, command.commandId);
  }

  async getCommand(commandId: string): Promise<StoredCommand | undefined> {
    return this.commands.get(commandId);
  }

  async findCommandByIdempotencyKey(key: string): Promise<StoredCommand | undefined> {
    const commandId = this.commandIdByIdempotencyKey.get(key);
    return commandId === undefined ? undefined : this.commands.get(commandId);
  }

  async setCommandStatus(
    commandId: string,
    status: CommandStatus,
    errorCode?: string,
  ): Promise<void> {
    const stored = this.commands.get(commandId);
    if (!stored) throw new Error(`unknown command ${commandId}`);
    stored.status = status;
    stored.updatedAt = new Date().toISOString();
    if (errorCode !== undefined) stored.lastErrorCode = errorCode;
  }

  async recordDispatchAttempt(commandId: string): Promise<number> {
    const stored = this.commands.get(commandId);
    if (!stored) throw new Error(`unknown command ${commandId}`);
    stored.attempts += 1;
    return stored.attempts;
  }

  async registerDeviceEvent(input: {
    deviceId: string;
    sequenceNumber: number;
    idempotencyKey: string;
  }): Promise<DeviceEventVerdict> {
    const dedupeKey = `${input.deviceId}:${input.idempotencyKey}`;
    // dedupe first: a retransmit of an already-accepted event carries a stale
    // sequence but must still be acked ok
    if (this.seenEventKeys.has(dedupeKey)) return "duplicate";
    const last = this.eventSequences.get(input.deviceId);
    if (last !== undefined && input.sequenceNumber <= last) return "stale";
    this.eventSequences.set(input.deviceId, input.sequenceNumber);
    this.seenEventKeys.add(dedupeKey);
    return "accepted";
  }

  async lastEventSequence(deviceId: string): Promise<number | undefined> {
    return this.eventSequences.get(deviceId);
  }
}

export class InMemoryEventSink implements EventSink {
  readonly events: DeviceEvent[] = [];

  async handleDeviceEvent(event: DeviceEvent): Promise<void> {
    this.events.push(event);
  }
}
