import {
  interpretedContextSchema,
  type ActivationContext,
  type InterpretedContext,
} from "@soon/shared-types";
import type { LanguageModel } from "ai";
import { generateStructured } from "./generate.js";

const SYSTEM = [
  "you interpret imessage conversations for a quiet scheduling utility.",
  "extract only facts explicitly supported by the messages.",
  "never infer an exact time, location, duration, or email address that is not present in the text.",
  "leave optional fields absent when the conversation does not support them.",
  "dateHints and hardConstraints are verbatim-adjacent paraphrases of what was said, never inventions.",
  "you never compute availability and you never decide what happens next.",
].join(" ");

function renderContext(ctx: ActivationContext): string {
  const participants = ctx.participants
    .map((p) => `${p.isUser ? "user" : "attendee"}: ${p.displayName ?? p.handle}`)
    .join(", ");
  const transcript = ctx.messages
    .map((m) => `[${m.sentAt}] ${m.senderType}: ${m.text}`)
    .join("\n");
  return [
    `participants: ${participants}`,
    `group chat: ${ctx.isGroup ? "yes" : "no"}`,
    `trigger message: ${ctx.triggerText}`,
    "conversation (oldest first):",
    transcript,
  ].join("\n");
}

/** structured read of the conversation that activated soon */
export async function interpretActivationContext(
  llm: LanguageModel,
  ctx: ActivationContext,
): Promise<InterpretedContext> {
  return generateStructured({
    model: llm,
    schema: interpretedContextSchema,
    schemaName: "interpreted_context",
    system: SYSTEM,
    prompt: renderContext(ctx),
  });
}
