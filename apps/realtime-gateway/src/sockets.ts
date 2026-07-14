import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { SOCKET_EVENTS, type Ack } from "@soon/realtime-protocol";
import { verifyDeviceJwt, type VerifyDeviceJwtKeys } from "@soon/security";
import type { Logger } from "@soon/observability";
import { handleDeviceEvent } from "./device-events.js";
import type { CommandStore, EventSink } from "./store.js";

interface SocketData {
  deviceId: string;
  userId: string;
}

export type DeviceSocket = Socket<
  Record<string, (...args: never[]) => void>,
  Record<string, (...args: unknown[]) => void>,
  Record<string, never>,
  SocketData
>;

/** tracks the single active socket per device */
export class DeviceRegistry {
  private sockets = new Map<string, DeviceSocket>();

  get(deviceId: string): DeviceSocket | undefined {
    return this.sockets.get(deviceId);
  }

  count(): number {
    return this.sockets.size;
  }

  /** register a socket, returning the previous one (to be disconnected) if any */
  register(deviceId: string, socket: DeviceSocket): DeviceSocket | undefined {
    const previous = this.sockets.get(deviceId);
    this.sockets.set(deviceId, socket);
    return previous && previous.id !== socket.id ? previous : undefined;
  }

  /** unregister only if this exact socket is still the active one */
  unregister(deviceId: string, socket: DeviceSocket): void {
    if (this.sockets.get(deviceId)?.id === socket.id) {
      this.sockets.delete(deviceId);
    }
  }
}

export interface AttachSocketServerOptions {
  httpServer: HttpServer;
  jwtKeys: VerifyDeviceJwtKeys;
  store: CommandStore;
  sink: EventSink;
  logger: Logger;
  registry: DeviceRegistry;
}

export function roomForDevice(deviceId: string): string {
  return `device:${deviceId}`;
}

export function attachSocketServer(options: AttachSocketServerOptions): Server {
  const { httpServer, jwtKeys, store, sink, logger, registry } = options;
  const io = new Server(httpServer, {
    // heartbeat: server pings every 20s, drops after 15s of silence
    pingInterval: 20_000,
    pingTimeout: 15_000,
    cors: { origin: false },
  });

  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth["token"];
    if (typeof token !== "string" || token.length === 0) {
      next(new Error("unauthorized"));
      return;
    }
    verifyDeviceJwt(token, jwtKeys)
      .then((claims) => {
        const data = socket.data as SocketData;
        data.deviceId = claims.deviceId;
        data.userId = claims.userId;
        next();
      })
      .catch(() => {
        logger.warn({ socketId: socket.id }, "socket auth rejected");
        next(new Error("unauthorized"));
      });
  });

  io.on("connection", (socket) => {
    const { deviceId } = socket.data as SocketData;
    // one active socket per device: newest wins, older one is disconnected
    const previous = registry.register(deviceId, socket as unknown as DeviceSocket);
    if (previous) {
      logger.info({ deviceId, socketId: previous.id }, "disconnecting superseded device socket");
      previous.disconnect(true);
    }
    void socket.join(roomForDevice(deviceId));
    logger.info({ deviceId, socketId: socket.id }, "device connected");

    socket.on(SOCKET_EVENTS.deviceEvent, (raw: unknown, callback?: (ack: Ack) => void) => {
      void handleDeviceEvent(raw, { store, sink, logger, authenticatedDeviceId: deviceId }).then(
        (ack) => {
          if (typeof callback === "function") callback(ack);
        },
      );
    });

    socket.on("disconnect", (reason) => {
      registry.unregister(deviceId, socket as unknown as DeviceSocket);
      logger.info({ deviceId, socketId: socket.id, reason }, "device disconnected");
    });
  });

  return io;
}
