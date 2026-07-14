import { describe, expect, it } from "vitest";
import {
  PREFERENCE_ACTIVATION_THRESHOLD,
  accumulatePreference,
  captureEditDiff,
  resetStyleProfile,
  type StyleProfile,
} from "./learning.js";

describe("captureEditDiff", () => {
  it("returns no signals for unchanged text", () => {
    expect(captureEditDiff("sounds good", "sounds good")).toEqual([]);
  });

  it("detects formality removed", () => {
    const signals = captureEditDiff(
      "unfortunately that day is full, please let me know what works",
      "that day is full, what else works",
    );
    expect(signals.map((s) => s.kind)).toContain("formality_removed");
  });

  it("detects terminal punctuation stripped", () => {
    expect(
      captureEditDiff("tuesday at 3pm works.", "tuesday at 3pm works").map((s) => s.kind),
    ).toContain("terminal_punctuation_stripped");
  });

  it("detects shortening", () => {
    const signals = captureEditDiff(
      "i think tuesday at 3pm could work well, or wednesday morning if that is easier for you",
      "tues 3pm or weds am?",
    );
    expect(signals.map((s) => s.kind)).toContain("shortened");
  });

  it("detects emoji added and removed", () => {
    expect(captureEditDiff("see you tuesday", "see you tuesday 🎉").map((s) => s.kind)).toContain(
      "emoji_added",
    );
    expect(captureEditDiff("see you tuesday 🎉", "see you tuesday").map((s) => s.kind)).toContain(
      "emoji_removed",
    );
  });

  it("detects option count reduced", () => {
    const signals = captureEditDiff(
      "i could do 3pm, 4pm, or 5pm",
      "i could do 3pm or 4pm",
    );
    expect(signals.map((s) => s.kind)).toContain("option_count_reduced");
  });

  it("detects time format changed", () => {
    const signals = captureEditDiff("does 3:00 pm work", "does 3pm work");
    const changed = signals.find((s) => s.kind === "time_format_changed");
    expect(changed?.detail).toBe("compact");
  });

  it("detects lowercasing", () => {
    expect(captureEditDiff("Does tuesday work", "does tuesday work").map((s) => s.kind)).toContain(
      "lowercased",
    );
  });
});

describe("accumulatePreference", () => {
  it("only activates after the threshold of consistent observations", () => {
    let profile: StyleProfile = resetStyleProfile();
    for (let i = 1; i < PREFERENCE_ACTIVATION_THRESHOLD; i += 1) {
      profile = accumulatePreference(profile, { kind: "shortened" });
      expect(profile.shortened?.active).toBe(false);
    }
    profile = accumulatePreference(profile, { kind: "shortened" });
    expect(profile.shortened).toEqual({
      observations: PREFERENCE_ACTIVATION_THRESHOLD,
      active: true,
    });
  });

  it("an opposing observation resets the streak", () => {
    let profile: StyleProfile = resetStyleProfile();
    profile = accumulatePreference(profile, { kind: "emoji_added" });
    profile = accumulatePreference(profile, { kind: "emoji_added" });
    profile = accumulatePreference(profile, { kind: "emoji_removed" });
    expect(profile.emoji_added).toEqual({ observations: 0, active: false });
    // two more consistent adds still are not enough after the reset
    profile = accumulatePreference(profile, { kind: "emoji_added" });
    profile = accumulatePreference(profile, { kind: "emoji_added" });
    expect(profile.emoji_added?.active).toBe(false);
    profile = accumulatePreference(profile, { kind: "emoji_added" });
    expect(profile.emoji_added?.active).toBe(true);
  });

  it("is immutable", () => {
    const before: StyleProfile = resetStyleProfile();
    const after = accumulatePreference(before, { kind: "lowercased" });
    expect(before).toEqual({});
    expect(after.lowercased?.observations).toBe(1);
  });

  it("resetStyleProfile clears everything", () => {
    expect(resetStyleProfile()).toEqual({});
  });
});
