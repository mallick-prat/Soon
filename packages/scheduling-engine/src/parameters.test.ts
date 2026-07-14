import { describe, expect, it } from "vitest";
import { parseTriggerModifiers, resolveMeetingParameters } from "./parameters.js";

const USER_DEFAULT = { meetingType: "catch_up", durationMinutes: 30, format: "unspecified" } as const;

describe("resolveMeetingParameters", () => {
  it("uses user defaults when nothing else applies", () => {
    expect(resolveMeetingParameters({ userDefault: { ...USER_DEFAULT } })).toEqual(USER_DEFAULT);
  });

  it("preset beats user default: lunch conversation uses lunch duration", () => {
    const resolved = resolveMeetingParameters({
      userDefault: { ...USER_DEFAULT },
      preset: { meetingType: "lunch", durationMinutes: 60 },
    });
    expect(resolved.durationMinutes).toBe(60);
    expect(resolved.meetingType).toBe("lunch");
  });

  it("trigger modifier beats everything", () => {
    const resolved = resolveMeetingParameters({
      userDefault: { ...USER_DEFAULT },
      preset: { durationMinutes: 60 },
      conversation: { durationMinutes: 45 },
      triggerModifier: { durationMinutes: 15 },
    });
    expect(resolved.durationMinutes).toBe(15);
  });
});

describe("parseTriggerModifiers", () => {
  it("parses durations", () => {
    expect(parseTriggerModifiers("15m").durationMinutes).toBe(15);
    expect(parseTriggerModifiers("30m").durationMinutes).toBe(30);
    expect(parseTriggerModifiers("45m").durationMinutes).toBe(45);
    expect(parseTriggerModifiers("1h").durationMinutes).toBe(60);
  });

  it("parses meeting types with preset durations", () => {
    expect(parseTriggerModifiers("coffee")).toMatchObject({ meetingType: "coffee", durationMinutes: 45 });
    expect(parseTriggerModifiers("lunch")).toMatchObject({ meetingType: "lunch", durationMinutes: 60 });
    expect(parseTriggerModifiers("dinner")).toMatchObject({ meetingType: "dinner", durationMinutes: 90 });
  });

  it("parses formats", () => {
    expect(parseTriggerModifiers("virtual").format).toBe("virtual");
    expect(parseTriggerModifiers("phone").format).toBe("phone");
    expect(parseTriggerModifiers("in person").format).toBe("in_person");
  });

  it("parses follow-up and bundle commands", () => {
    expect(parseTriggerModifiers("follow up until scheduled").followUpPolicy).toBe("until_scheduled");
    expect(parseTriggerModifiers("no follow ups").followUpPolicy).toBe("none");
    expect(parseTriggerModifiers("handle 3").bundleSize).toBe(3);
  });

  it("treats free text as a date hint", () => {
    expect(parseTriggerModifiers("next week").dateHint).toBe("next week");
    expect(parseTriggerModifiers("tomorrow").dateHint).toBe("tomorrow");
  });

  it("returns empty for a bare trigger", () => {
    expect(parseTriggerModifiers("")).toEqual({});
  });
});
