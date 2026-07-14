import { describe, expect, it } from "vitest";
import { createLlm } from "./llm.js";

describe("createLlm", () => {
  it("creates an openai model", () => {
    const model = createLlm({ provider: "openai", model: "gpt-4o-mini", apiKey: "test-key" }) as {
      modelId: string;
      provider: string;
    };
    expect(model.modelId).toBe("gpt-4o-mini");
    expect(model.provider).toContain("openai");
  });

  it("creates an anthropic model", () => {
    const model = createLlm({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    }) as { modelId: string; provider: string };
    expect(model.modelId).toBe("claude-sonnet-4-5");
    expect(model.provider).toContain("anthropic");
  });
});
