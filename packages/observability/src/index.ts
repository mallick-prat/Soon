import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pino, type DestinationStream, type Logger } from "pino";

const CENSOR = "[redacted]";

/** field names that must never appear in logs in the clear */
const SENSITIVE_KEYS = [
  "text",
  "sanitizedText",
  "message",
  "body",
  "email",
  "phone",
  "accessToken",
  "refreshToken",
  "token",
  "authorization",
  "signature",
] as const;

function redactionPaths(extra: readonly string[] = []): string[] {
  const paths = new Set<string>();
  for (const key of SENSITIVE_KEYS) {
    paths.add(key);
    paths.add(`*.${key}`);
    paths.add(`*.*.${key}`);
  }
  for (const path of extra) paths.add(path);
  return [...paths];
}

function prettyTransportAvailable(): boolean {
  if (process.env["NODE_ENV"] !== "development") return false;
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  /** extra pino redaction paths on top of the built-in sensitive-field list */
  redactExtra?: readonly string[];
  /** test seam: write logs to this stream instead of stdout/pretty */
  destination?: DestinationStream;
}

/**
 * create a pino logger with mandatory redaction of message bodies, tokens,
 * emails, phone numbers, and signatures. pretty output only in development
 * when pino-pretty is resolvable; plain json everywhere else.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
  const { name, level, redactExtra, destination } = options;
  const base = {
    name,
    level: level ?? process.env["LOG_LEVEL"] ?? "info",
    redact: { paths: redactionPaths(redactExtra), censor: CENSOR },
  };
  if (destination) return pino(base, destination);
  if (prettyTransportAvailable()) {
    return pino({
      ...base,
      transport: { target: "pino-pretty", options: { colorize: true } },
    });
  }
  return pino(base);
}

export interface CorrelationIds {
  sessionId?: string;
  workflowRunId?: string;
  commandId?: string;
  deviceId?: string;
}

/** child logger carrying correlation ids; undefined ids are omitted */
export function withCorrelation(logger: Logger, ids: CorrelationIds): Logger {
  const bindings: Record<string, string> = {};
  if (ids.sessionId !== undefined) bindings["sessionId"] = ids.sessionId;
  if (ids.workflowRunId !== undefined) bindings["workflowRunId"] = ids.workflowRunId;
  if (ids.commandId !== undefined) bindings["commandId"] = ids.commandId;
  if (ids.deviceId !== undefined) bindings["deviceId"] = ids.deviceId;
  return logger.child(bindings);
}

/**
 * stable short hash for participant handles (phone numbers, emails) so
 * identities can be correlated in logs without ever logging the handle.
 */
export function hashParticipant(handle: string): string {
  return createHash("sha256").update(handle.trim().toLowerCase(), "utf8").digest("hex").slice(0, 12);
}

export type { Logger } from "pino";
