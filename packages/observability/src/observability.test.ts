import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { createLogger, hashParticipant, withCorrelation } from "./index.js";

function captureLogger(level = "info") {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) lines.push(JSON.parse(line));
      }
      cb();
    },
  });
  const logger = createLogger({ name: "test", level, destination: stream });
  return { logger, lines };
}

describe("createLogger redaction", () => {
  it("redacts top-level sensitive fields", () => {
    const { logger, lines } = captureLogger();
    logger.info(
      { text: "hi there", token: "tok_123", email: "a@b.com", phone: "+15550001111" },
      "event",
    );
    const line = lines[0]!;
    expect(line["text"]).toBe("[redacted]");
    expect(line["token"]).toBe("[redacted]");
    expect(line["email"]).toBe("[redacted]");
    expect(line["phone"]).toBe("[redacted]");
    expect(JSON.stringify(line)).not.toContain("hi there");
    expect(JSON.stringify(line)).not.toContain("tok_123");
  });

  it("redacts nested sensitive fields one and two levels deep", () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        event: { sanitizedText: "secret body", authorization: "bearer x" },
        deep: { inner: { refreshToken: "rt_999", signature: "sig" } },
      },
      "nested",
    );
    const line = lines[0]! as Record<string, Record<string, unknown>>;
    expect(line["event"]!["sanitizedText"]).toBe("[redacted]");
    expect(line["event"]!["authorization"]).toBe("[redacted]");
    expect((line["deep"]!["inner"] as Record<string, unknown>)["refreshToken"]).toBe("[redacted]");
    expect(JSON.stringify(line)).not.toContain("secret body");
    expect(JSON.stringify(line)).not.toContain("rt_999");
  });

  it("redacts message/body/accessToken keys", () => {
    const { logger, lines } = captureLogger();
    logger.info({ payload: { message: "m", body: "b", accessToken: "at" } }, "x");
    const payload = (lines[0]! as Record<string, Record<string, unknown>>)["payload"]!;
    expect(payload["message"]).toBe("[redacted]");
    expect(payload["body"]).toBe("[redacted]");
    expect(payload["accessToken"]).toBe("[redacted]");
  });

  it("supports extra redaction paths", () => {
    const { lines } = (() => {
      const lines: Record<string, unknown>[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) {
          lines.push(JSON.parse(chunk.toString()));
          cb();
        },
      });
      const logger = createLogger({
        name: "test",
        destination: stream,
        redactExtra: ["custom.secretField"],
      });
      logger.info({ custom: { secretField: "hide me", other: "keep" } }, "x");
      return { lines };
    })();
    const custom = (lines[0]! as Record<string, Record<string, unknown>>)["custom"]!;
    expect(custom["secretField"]).toBe("[redacted]");
    expect(custom["other"]).toBe("keep");
  });

  it("leaves non-sensitive fields intact and respects level", () => {
    const { logger, lines } = captureLogger("warn");
    logger.info({ commandId: "c1" }, "should be suppressed");
    logger.warn({ commandId: "c1", status: "delivered" }, "kept");
    expect(lines).toHaveLength(1);
    expect(lines[0]!["commandId"]).toBe("c1");
    expect(lines[0]!["status"]).toBe("delivered");
  });
});

describe("withCorrelation", () => {
  it("binds only the provided ids to a child logger", () => {
    const { logger, lines } = captureLogger();
    const child = withCorrelation(logger, { sessionId: "s1", commandId: "c1" });
    child.info("correlated");
    expect(lines[0]!["sessionId"]).toBe("s1");
    expect(lines[0]!["commandId"]).toBe("c1");
    expect(lines[0]).not.toHaveProperty("workflowRunId");
    expect(lines[0]).not.toHaveProperty("deviceId");
  });

  it("child loggers still redact sensitive fields", () => {
    const { logger, lines } = captureLogger();
    const child = withCorrelation(logger, { deviceId: "d1" });
    child.info({ text: "body text" }, "x");
    expect(lines[0]!["text"]).toBe("[redacted]");
    expect(lines[0]!["deviceId"]).toBe("d1");
  });
});

describe("hashParticipant", () => {
  it("is stable for the same handle (case/whitespace insensitive)", () => {
    expect(hashParticipant("+1 555 000 1111".trim())).toBe(hashParticipant("+1 555 000 1111"));
    expect(hashParticipant("A@B.com")).toBe(hashParticipant(" a@b.com "));
  });

  it("is a 12-char hex string that differs across handles", () => {
    const a = hashParticipant("a@b.com");
    const b = hashParticipant("c@d.com");
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it("never contains the original handle", () => {
    const handle = "person@example.com";
    expect(hashParticipant(handle)).not.toContain(handle);
  });
});
