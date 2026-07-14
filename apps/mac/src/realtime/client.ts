/**
 * realtime client — socket.io connection to the soon gateway with
 * auto-reconnect, device jwt auth, command handling via CommandProcessor,
 * and an outbound queue of validated device events.
 */
import pRetry from "p-retry";
import pTimeout from "p-timeout";
import { io, type Socket } from "socket.io-client";

import { SOCKET_EVENTS, deviceEventSchema, type Ack, type DeviceEvent } from "@soon/realtime-protocol";

import type { CommandProcessor } from "./processor.js";

/** minimal socket surface so tests can inject a fake. */
export interface SocketLike {
  connected: boolean;
  on(event: string, cb: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
  connect(): void;
  disconnect(): void;
}

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

export interface RealtimeClientOptions {
  url: string;
  getToken: () => string | Promise<string>;
  processor: CommandProcessor;
  onStatusChange?: (status: RealtimeStatus) => void;
  socketFactory?: (url: string, auth: () => Promise<{ token: string }>) => SocketLike;
  ackTimeoutMs?: number;
  log?: (message: string, detail?: unknown) => void;
}

const defaultSocketFactory =
  (url: string, auth: () => Promise<{ token: string }>): SocketLike =>
    io(url, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      auth: (cb) => {
        void auth().then(cb);
      },
    }) as unknown as Socket as unknown as SocketLike;

export class RealtimeClient {
  private socket: SocketLike | undefined;
  private readonly options: RealtimeClientOptions;
  private readonly queue: DeviceEvent[] = [];
  private status: RealtimeStatus = "disconnected";
  private flushing = false;

  constructor(options: RealtimeClientOptions) {
    this.options = options;
  }

  connect(): void {
    if (this.socket !== undefined) {
      this.socket.connect();
      return;
    }
    const factory = this.options.socketFactory ?? ((url, auth) => defaultSocketFactory(url, auth));
    const socket = factory(this.options.url, async () => ({ token: await this.options.getToken() }));
    this.socket = socket;

    socket.on("connect", () => {
      this.setStatus("connected");
      void this.flushQueue();
    });
    socket.on("disconnect", () => this.setStatus("disconnected"));
    socket.on("connect_error", (err) => {
      this.options.log?.("realtime connect error", err);
      this.setStatus("disconnected");
    });
    socket.on(SOCKET_EVENTS.command, (raw: unknown, ackCb?: unknown) => {
      void this.options.processor.handle(raw).then((result: Ack) => {
        if (typeof ackCb === "function") (ackCb as (a: Ack) => void)(result);
      });
    });
    this.setStatus("connecting");
  }

  /** force a fresh connection (wake from sleep, network change). */
  reconnect(): void {
    this.socket?.disconnect();
    this.socket?.connect();
    this.setStatus("connecting");
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.setStatus("disconnected");
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /** queue a validated device event; flushes when connected, with acks. */
  async emitEvent(event: DeviceEvent): Promise<void> {
    deviceEventSchema.parse(event);
    this.queue.push(event);
    await this.flushQueue();
  }

  private async flushQueue(): Promise<void> {
    if (this.flushing) return;
    const socket = this.socket;
    if (socket === undefined || !socket.connected) return;
    this.flushing = true;
    try {
      while (this.queue.length > 0 && socket.connected) {
        const event = this.queue[0];
        if (event === undefined) break;
        await pRetry(() => this.emitWithAck(socket, event), {
          retries: 2,
          minTimeout: 250,
        });
        this.queue.shift();
      }
    } catch (error) {
      this.options.log?.("device event delivery failed; will retry on reconnect", error);
    } finally {
      this.flushing = false;
    }
  }

  private emitWithAck(socket: SocketLike, event: DeviceEvent): Promise<void> {
    const attempt = new Promise<void>((resolve, reject) => {
      socket.emit(SOCKET_EVENTS.deviceEvent, event, (response: unknown) => {
        const okay =
          typeof response === "object" && response !== null && "ok" in response
            ? (response as { ok: unknown }).ok === true
            : false;
        if (okay) resolve();
        else reject(new Error("event rejected by gateway"));
      });
    });
    return pTimeout(attempt, { milliseconds: this.options.ackTimeoutMs ?? 10_000 });
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}
