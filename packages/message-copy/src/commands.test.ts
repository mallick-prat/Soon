import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands.js";

describe("parseCommand", () => {
  it("parses every simple command", () => {
    expect(parseCommand("📅 stop", "📅")).toEqual({ kind: "stop" });
    expect(parseCommand("📅 status", "📅")).toEqual({ kind: "status" });
    expect(parseCommand("📅 take over", "📅")).toEqual({ kind: "take_over" });
    expect(parseCommand("📅 takeover", "📅")).toEqual({ kind: "take_over" });
    expect(parseCommand("📅 resume", "📅")).toEqual({ kind: "resume" });
    expect(parseCommand("📅 cancel", "📅")).toEqual({ kind: "cancel" });
    expect(parseCommand("📅 undo", "📅")).toEqual({ kind: "undo" });
  });

  it("parses approve with a count", () => {
    expect(parseCommand("📅 approve 3", "📅")).toEqual({ kind: "approve", count: 3 });
    expect(parseCommand("📅 approve 12", "📅")).toEqual({ kind: "approve", count: 12 });
  });

  it("defaults approve to count 1", () => {
    expect(parseCommand("📅 approve", "📅")).toEqual({ kind: "approve", count: 1 });
  });

  it("is case- and whitespace-insensitive", () => {
    expect(parseCommand("📅  STOP ", "📅")).toEqual({ kind: "stop" });
    expect(parseCommand("📅 Take   Over", "📅")).toEqual({ kind: "take_over" });
    expect(parseCommand("📅 Approve 2", "📅")).toEqual({ kind: "approve", count: 2 });
  });

  it("is generic over the configured trigger", () => {
    expect(parseCommand("👩‍💻 stop", "👩‍💻")).toEqual({ kind: "stop" });
    expect(parseCommand("🦄 approve 5", "🦄")).toEqual({ kind: "approve", count: 5 });
    expect(parseCommand("📅 stop", "🦄")).toBeNull();
  });

  it("returns null for standalone triggers and non-commands", () => {
    expect(parseCommand("📅", "📅")).toBeNull();
    expect(parseCommand("📅 30m", "📅")).toBeNull();
    expect(parseCommand("📅 approve zero", "📅")).toBeNull();
    expect(parseCommand("📅 approve 0", "📅")).toBeNull();
    expect(parseCommand("please 📅 stop", "📅")).toBeNull();
    expect(parseCommand("stop", "📅")).toBeNull();
  });
});
