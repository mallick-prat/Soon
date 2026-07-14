import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type LlmProvider = "openai" | "anthropic";

/** caller reads these from LLM_PROVIDER / LLM_MODEL / LLM_API_KEY */
export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
}

/**
 * provider-agnostic model factory. everything downstream takes the returned
 * LanguageModel, so tests inject MockLanguageModelV3 from "ai/test" instead.
 */
export function createLlm(config: LlmConfig): LanguageModel {
  switch (config.provider) {
    case "openai":
      return createOpenAI({ apiKey: config.apiKey })(config.model);
    case "anthropic":
      return createAnthropic({ apiKey: config.apiKey })(config.model);
  }
}
