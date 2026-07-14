import { describe, expect, it } from "vitest";
import { notificationCopy, onboardingCopy, renderCopy, statusCopy } from "./copy.js";

describe("renderCopy", () => {
  it("interpolates {name}", () => {
    expect(renderCopy(notificationCopy.draftingTimes, { name: "sarah" })).toBe(
      "drafting times for sarah",
    );
    expect(renderCopy(notificationCopy.keepTrying, { name: "alex" })).toBe(
      "keep trying with alex?",
    );
  });

  it("leaves unknown placeholders intact", () => {
    expect(renderCopy("scheduled with {name}", {})).toBe("scheduled with {name}");
  });

  it("interpolates multiple occurrences", () => {
    expect(renderCopy("{name} and {name}", { name: "jo" })).toBe("jo and jo");
  });
});

describe("copy strings", () => {
  it("all product copy is lowercase", () => {
    const all = [
      ...Object.values(notificationCopy),
      ...Object.values(statusCopy),
      ...Object.values(onboardingCopy),
    ];
    for (const text of all) {
      expect(text).toBe(text.toLowerCase());
    }
  });

  it("exposes the core notification strings", () => {
    expect(notificationCopy.handling).toBe("soon is handling this");
    expect(notificationCopy.couldntLand).toBe("couldn't land this one");
    expect(notificationCopy.reconnectCalendar).toBe("reconnect google calendar");
    expect(notificationCopy.alreadyHandling).toBe("already handling this conversation");
  });
});
