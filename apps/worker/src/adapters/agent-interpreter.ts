/**
 * Interpreter port over @soon/agent. the agent functions take a LanguageModel
 * as their first arg and read no env; this adapter holds one model and bridges
 * the port shape to the agent shape (the two don't line up 1:1 — see the
 * per-method notes below). the agent calls are injectable so the bridging
 * logic is unit-testable without a live model.
 */
import {
  createLlm,
  draftMessage,
  formatSlotLabel,
  interpretActivationContext,
  interpretReply,
  NoValidDraftError,
  type LlmProvider,
} from "@soon/agent";
import type { CandidateSlot, RelationshipType } from "@soon/shared-types";

import type { Interpreter } from "../ports.js";

/** the model handle @soon/agent expects (a LanguageModel from the `ai` sdk). */
type Llm = ReturnType<typeof createLlm>;

const DEFAULT_TIMEZONE = "America/New_York";

export interface AgentInterpreterDeps {
  llm: Llm;
  /** used when a draft has no slots to borrow a timezone from (e.g. follow-ups) */
  defaultTimezone?: string;
  /** relationship tone when the port can't supply one */
  defaultRelationship?: RelationshipType;
  // injectable agent seams (default to @soon/agent) — tests pass fakes.
  draftFn?: typeof draftMessage;
  interpretContextFn?: typeof interpretActivationContext;
  interpretReplyFn?: typeof interpretReply;
}

/** build the LlmConfig from env and construct the model. throws (naming vars) if unset. */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): Llm {
  const provider = env["LLM_PROVIDER"];
  const model = env["LLM_MODEL"];
  const apiKey = env["LLM_API_KEY"];
  if (provider !== "openai" && provider !== "anthropic") {
    throw new Error("LLM_PROVIDER must be 'openai' or 'anthropic'");
  }
  if (!model) throw new Error("LLM_MODEL is required");
  if (!apiKey) throw new Error("LLM_API_KEY is required");
  return createLlm({ provider: provider as LlmProvider, model, apiKey });
}

export function createAgentInterpreter(deps: AgentInterpreterDeps): Interpreter {
  const { llm } = deps;
  const defaultTimezone = deps.defaultTimezone ?? DEFAULT_TIMEZONE;
  const relationship = deps.defaultRelationship ?? "unknown";
  const draftImpl = deps.draftFn ?? draftMessage;
  const interpretContextImpl = deps.interpretContextFn ?? interpretActivationContext;
  const interpretReplyImpl = deps.interpretReplyFn ?? interpretReply;

  return {
    // direct pass-through — same ActivationContext in, InterpretedContext out.
    interpretContext: (ctx) => interpretContextImpl(llm, ctx),

    interpretReply: (input) =>
      interpretReplyImpl(llm, {
        replyText: input.replyText,
        // the port doesn't carry recent messages; the reply guards work off
        // the reply text + proposed slots alone.
        recentMessages: [],
        proposedSlots: input.proposedSlots.map((slot) => ({
          id: slot.id,
          label: formatSlotLabel(slot),
        })),
        lastOutboundText: input.lastOutboundText,
      }),

    draft: async (input) => {
      const slots = input.slots.map((slot: CandidateSlot) => ({
        id: slot.id,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        timezone: slot.timezone,
      }));
      const result = await draftImpl(llm, {
        objective: input.objective,
        slots,
        relationship,
        // the port passes raw examples; style directives are derived upstream.
        styleDirectives: "",
        styleExamples: input.styleExamples,
        userTimezone: input.slots[0]?.timezone ?? defaultTimezone,
        ...(input.priorText !== undefined ? { extraContext: input.priorText } : {}),
      });
      const [text, ...alternatives] = result.drafts;
      if (text === undefined) {
        // no candidate survived validation — surface it so the durable
        // workflow retries rather than sending an empty message.
        throw new NoValidDraftError(result.rejected);
      }
      // the agent layer produces no confidence signal; a surviving draft has
      // already passed time-verification + style guards, so treat it as high.
      return { text, alternatives, confidence: 0.9 };
    },
  };
}
