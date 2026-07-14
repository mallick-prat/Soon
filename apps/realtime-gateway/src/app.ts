import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import type { Server } from "socket.io";
import { cloudCommandSchema } from "@soon/realtime-protocol";
import { verifyEnvelopeSignature, type VerifyDeviceJwtKeys } from "@soon/security";
import { createLogger, type Logger } from "@soon/observability";
import type { GatewayConfig } from "./config.js";
import { createCommandDispatcher, type CommandDispatcher } from "./dispatch.js";
import { attachSocketServer, DeviceRegistry } from "./sockets.js";
import { InMemoryCommandStore, InMemoryEventSink, type CommandStore, type EventSink } from "./store.js";

export interface BuildAppOptions {
  config: GatewayConfig;
  store?: CommandStore;
  sink?: EventSink;
  logger?: Logger;
  /** override dispatch timing in tests */
  dispatch?: {
    ackTimeoutMs?: number;
    attempts?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
  };
}

export interface Gateway {
  app: FastifyInstance;
  io: Server;
  registry: DeviceRegistry;
  store: CommandStore;
  sink: EventSink;
  dispatcher: CommandDispatcher;
  logger: Logger;
}

function bearerTokenMatches(header: string | undefined, expected: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) return false;
  return timingSafeEqual(provided, wanted);
}

export function jwtKeysFromConfig(config: GatewayConfig): VerifyDeviceJwtKeys {
  if (config.REALTIME_JWT_PUBLIC_KEY !== undefined) {
    return { publicKeyPem: config.REALTIME_JWT_PUBLIC_KEY };
  }
  return { secret: config.DEVICE_JWT_SECRET as string };
}

export async function buildApp(options: BuildAppOptions): Promise<Gateway> {
  const { config } = options;
  const logger =
    options.logger ??
    createLogger({
      name: "realtime-gateway",
      ...(config.LOG_LEVEL !== undefined ? { level: config.LOG_LEVEL } : {}),
    });
  const store = options.store ?? new InMemoryCommandStore();
  const sink = options.sink ?? new InMemoryEventSink();
  const registry = new DeviceRegistry();
  const startedAt = Date.now();

  const app = Fastify({ logger: false });
  await app.register(helmet);
  await app.register(cors, { origin: false });

  const io = attachSocketServer({
    httpServer: app.server,
    jwtKeys: jwtKeysFromConfig(config),
    store,
    sink,
    logger,
    registry,
  });

  const dispatcher = createCommandDispatcher({
    store,
    logger,
    getSocket: (deviceId) => registry.get(deviceId),
    ...(options.dispatch?.ackTimeoutMs !== undefined
      ? { ackTimeoutMs: options.dispatch.ackTimeoutMs }
      : {}),
    ...(options.dispatch?.attempts !== undefined ? { attempts: options.dispatch.attempts } : {}),
    ...(options.dispatch?.baseDelayMs !== undefined
      ? { baseDelayMs: options.dispatch.baseDelayMs }
      : {}),
    ...(options.dispatch?.sleep ? { sleep: options.dispatch.sleep } : {}),
    ...(options.dispatch?.now ? { now: options.dispatch.now } : {}),
  });

  app.get("/health", async () => ({
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    connectedDevices: registry.count(),
  }));

  app.post("/internal/commands", async (request, reply) => {
    if (!bearerTokenMatches(request.headers.authorization, config.INTERNAL_API_TOKEN)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = cloudCommandSchema.safeParse(request.body);
    if (!parsed.success) {
      // only issue paths — never echo payload contents back
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.map(String).join(".")))];
      return reply.code(400).send({ error: "invalid_command", fields });
    }
    const command = parsed.data;
    if (!verifyEnvelopeSignature(command as unknown as Record<string, unknown>, config.DEVICE_SIGNING_SECRET)) {
      logger.warn({ commandId: command.commandId }, "rejected command with bad signature");
      return reply.code(403).send({ error: "invalid_signature" });
    }
    const existing = await store.findCommandByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      return reply.code(200).send({
        commandId: existing.command.commandId,
        status: existing.status,
        deduplicated: true,
      });
    }
    await store.saveCommand(command);
    logger.info(
      { commandId: command.commandId, deviceId: command.deviceId, type: command.type },
      "command queued",
    );
    // dispatch asynchronously — the dispatcher owns retries/expiry/lifecycle
    void dispatcher.dispatch(command).catch((error: unknown) => {
      logger.error(
        { commandId: command.commandId, reason: error instanceof Error ? error.message : "unknown" },
        "dispatch crashed",
      );
    });
    return reply.code(202).send({ commandId: command.commandId, status: "created" });
  });

  app.addHook("onClose", async () => {
    await io.close();
  });

  return { app, io, registry, store, sink, dispatcher, logger };
}
