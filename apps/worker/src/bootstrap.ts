/**
 * worker transport bootstrap.
 *
 * wires the production CommandDispatcher (outbox-backed) and runs the outbox
 * drainer loop that relays commands to the gateway. this is the transport
 * half of the worker; the scheduling composition root (prisma SessionStore,
 * calendar-backed availability, @soon/agent interpreter) is a separate slice
 * still to be built — see the build-state notes.
 */
import { getDb } from "@soon/database";
import type { Logger } from "@soon/observability";

import { createAgentInterpreter, llmFromEnv } from "./adapters/agent-interpreter.js";
import {
  createCalendarAvailability,
  createDbCalendarContextResolver,
} from "./adapters/calendar-availability.js";
import { createGatewayDispatcher } from "./adapters/gateway-dispatcher.js";
import { createOutboxDrainer, type OutboxDrainerConfig } from "./adapters/outbox-drainer.js";
import { createPrismaSessionStore } from "./adapters/prisma-session-store.js";
import { configureComposition } from "./composition.js";
import type {
  AvailabilityService,
  Clock,
  CommandDispatcher,
  Interpreter,
  SessionStore,
} from "./ports.js";

/** the production CommandDispatcher — persists commands to outbox_commands. */
export function createProductionDispatcher(): CommandDispatcher {
  return createGatewayDispatcher();
}

export interface DrainerEnv {
  SOON_GATEWAY_URL?: string | undefined;
  GATEWAY_URL?: string | undefined;
  INTERNAL_API_TOKEN?: string | undefined;
  DEVICE_SIGNING_SECRET?: string | undefined;
  OUTBOX_DRAIN_BATCH_SIZE?: string | undefined;
}

/**
 * build the drainer config from environment, failing loudly (naming variables,
 * never values) when a required secret is missing.
 */
export function loadDrainerConfigFromEnv(
  env: DrainerEnv = process.env,
  logger?: Logger,
): OutboxDrainerConfig {
  const gatewayUrl = env.SOON_GATEWAY_URL ?? env.GATEWAY_URL;
  const internalToken = env.INTERNAL_API_TOKEN;
  const signingSecret = env.DEVICE_SIGNING_SECRET;

  const missing = [
    gatewayUrl ? null : "SOON_GATEWAY_URL",
    internalToken ? null : "INTERNAL_API_TOKEN",
    signingSecret ? null : "DEVICE_SIGNING_SECRET",
  ].filter((v): v is string => v !== null);
  if (missing.length > 0) {
    throw new Error(`outbox drainer misconfigured: missing ${missing.join(", ")}`);
  }

  const batch = env.OUTBOX_DRAIN_BATCH_SIZE ? Number(env.OUTBOX_DRAIN_BATCH_SIZE) : undefined;
  return {
    gatewayUrl: gatewayUrl as string,
    internalToken: internalToken as string,
    signingSecret: signingSecret as string,
    ...(batch !== undefined && Number.isFinite(batch) && batch > 0 ? { batchSize: batch } : {}),
    ...(logger !== undefined ? { logger } : {}),
  };
}

export interface DrainLoopHandle {
  stop(): void;
}

/**
 * run the drainer on a fixed interval until stop() is called. each pass is
 * isolated — a crash is logged and the loop continues on the next tick.
 */
export function startOutboxDrainer(
  config: OutboxDrainerConfig,
  options: { intervalMs?: number } = {},
): DrainLoopHandle {
  const intervalMs = options.intervalMs ?? 1_000;
  const drainer = createOutboxDrainer(config);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await drainer.drainOnce();
    } catch (error) {
      config.logger?.error(
        { reason: error instanceof Error ? error.message : "unknown" },
        "outbox drain pass crashed",
      );
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };
  void tick();

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

// --------------------------------------------------------------------------
// scheduling composition — assemble the real adapters into the worker's
// composition root so runProposalRound / confirm / reply-router run against
// prisma, the calendar, and the llm, and write commands to the outbox.
// --------------------------------------------------------------------------

/** null out raw session message text older than `days` (nightly retention). */
function createPrismaRetention(): { expireSessionMessageText(days: number): Promise<number> } {
  return {
    async expireSessionMessageText(days) {
      const cutoff = new Date(Date.now() - days * 86_400_000);
      const result = await getDb().sessionMessage.updateMany({
        where: { messageTimestamp: { lt: cutoff }, rawText: { not: null } },
        data: { rawText: null },
      });
      return result.count;
    },
  };
}

export interface CalendarEnv {
  GOOGLE_CALENDAR_CLIENT_ID?: string | undefined;
  GOOGLE_CALENDAR_CLIENT_SECRET?: string | undefined;
  TOKEN_ENCRYPTION_KEY?: string | undefined;
  DATA_ENCRYPTION_KEY_VERSION?: string | undefined;
}

/** build the calendar availability service from env (google client + token key). */
export function calendarAvailabilityFromEnv(env: CalendarEnv = process.env): AvailabilityService {
  const clientId = env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const tokenMasterKeyB64 = env.TOKEN_ENCRYPTION_KEY;
  const missing = [
    clientId ? null : "GOOGLE_CALENDAR_CLIENT_ID",
    clientSecret ? null : "GOOGLE_CALENDAR_CLIENT_SECRET",
    tokenMasterKeyB64 ? null : "TOKEN_ENCRYPTION_KEY",
  ].filter((v): v is string => v !== null);
  if (missing.length > 0) {
    throw new Error(`calendar availability misconfigured: missing ${missing.join(", ")}`);
  }
  const parsedVersion = Number(env.DATA_ENCRYPTION_KEY_VERSION ?? "1");
  return createCalendarAvailability({
    resolveContext: createDbCalendarContextResolver({
      clientId: clientId as string,
      clientSecret: clientSecret as string,
      tokenMasterKeyB64: tokenMasterKeyB64 as string,
      keyVersion: Number.isInteger(parsedVersion) && parsedVersion >= 0 ? parsedVersion : 1,
    }),
  });
}

export interface WorkerCompositionOverrides {
  store?: SessionStore;
  availability?: AvailabilityService;
  interpreter?: Interpreter;
  dispatcher?: CommandDispatcher;
  clock?: Clock;
  logger?: Logger;
}

/**
 * assemble the worker composition root: prisma store, calendar availability,
 * agent interpreter, outbox-backed dispatcher, wall clock, retention. any
 * piece can be overridden — tests inject fakes; production reads env. only the
 * pieces actually used are constructed, so a full override needs no env.
 */
export function configureWorker(overrides: WorkerCompositionOverrides = {}): void {
  configureComposition({
    store: overrides.store ?? createPrismaSessionStore(),
    availability: overrides.availability ?? calendarAvailabilityFromEnv(),
    interpreter: overrides.interpreter ?? createAgentInterpreter({ llm: llmFromEnv() }),
    dispatcher: overrides.dispatcher ?? createProductionDispatcher(),
    clock: overrides.clock ?? { now: () => new Date() },
    retention: createPrismaRetention(),
    ...(overrides.logger !== undefined ? { logger: overrides.logger } : {}),
  });
}
