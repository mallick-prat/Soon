import { describe, expect, it } from "vitest";
import { extractStyleFeatures } from "./features.js";
import { styleDirectives } from "./directives.js";

const lowercaseCasual = extractStyleFeatures([
  "hey whats up",
  "sounds good see u thurs at 3pm",
  "lets do coffee",
  "yep works",
]);

describe("styleDirectives", () => {
  it("is all lowercase and compact", () => {
    const directives = styleDirectives(lowercaseCasual, "close_friend");
    expect(directives).toBe(directives.toLowerCase());
    expect(directives.length).toBeLessThan(600);
  });

  it("reflects lowercase style and no exclamations", () => {
    const directives = styleDirectives(lowercaseCasual, "close_friend");
    expect(directives).toContain("write in all lowercase.");
    expect(directives).toContain("no exclamation marks.");
    expect(directives).toContain("keep it under 2 short sentences.");
  });

  it("conversation features dominate over relationship default", () => {
    // investor default leans polished, but this conversation is lowercase
    const directives = styleDirectives(lowercaseCasual, "investor");
    expect(directives).toContain("write in all lowercase.");
    // relationship still contributes tone
    expect(directives).toContain("warm but polished");
  });

  it("falls back to relationship default when no messages observed", () => {
    const empty = extractStyleFeatures([]);
    expect(styleDirectives(empty, "investor")).toContain("use normal sentence casing.");
    expect(styleDirectives(empty, "close_friend")).toContain("lowercase is fine.");
  });

  it("passes through observed acknowledgment phrases and time format", () => {
    const directives = styleDirectives(lowercaseCasual, "colleague");
    expect(directives).toContain("sounds good");
    expect(directives).toContain("write times like 3pm, not 3:00 pm.");
  });

  it("allows exclamations and emoji when the user uses them", () => {
    const excitable = extractStyleFeatures(["sounds great!!", "cant wait 🎉!", "yes!"]);
    const directives = styleDirectives(excitable, "close_friend");
    expect(directives).not.toContain("no exclamation marks.");
    expect(directives).not.toContain("no emoji.");
  });
});
