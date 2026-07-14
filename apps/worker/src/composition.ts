import pino, { type Logger } from "pino";
import type { AvailabilityService, Clock, CommandDispatcher, Interpreter, SessionStore } from "./ports.js";
import { runFollowUpTick } from "./follow-up-runner.js";

export type Composition = {
  store: SessionStore;
  availability: AvailabilityService;
  interpreter: Interpreter;
  dispatcher: CommandDispatcher;
  clock: Clock;
  logger: Logger;
  retention: { expireSessionMessageText(days: number): Promise<number> };
  runFollowUpTick(sessionId: string, conversationReference: string): Promise<unknown>;
};

let composition: Composition | null = null;

/**
 * composition root. production wiring (prisma store, calendar-backed
 * availability, @soon/agent interpreter, gateway dispatcher) is injected at
 * worker bootstrap; tests inject fakes. workflow tasks resolve dependencies
 * through here so their module scope stays replay-safe.
 */
export function configureComposition(partial: Omit<Composition, "runFollowUpTick" | "logger"> & { logger?: Logger }): void {
  const logger = partial.logger ?? pino({ name: "soon-worker" });
  composition = {
    ...partial,
    logger,
    async runFollowUpTick(sessionId, conversationReference) {
      const session = await partial.store.get(sessionId);
      // policy/attempts/snapshot loading is store-adapter concern; the default
      // wiring passes them through loadFollowUpState on the store adapter.
      const loader = partial.store as SessionStore & {
        loadFollowUpState?: (sessionId: string) => Promise<{
          policy: Parameters<typeof runFollowUpTick>[2];
          attempts: Parameters<typeof runFollowUpTick>[3];
          snapshot: Parameters<typeof runFollowUpTick>[4];
          styleExamples: string[];
        }>;
      };
      if (!loader.loadFollowUpState) {
        throw new Error("store adapter does not implement loadFollowUpState");
      }
      const state = await loader.loadFollowUpState(sessionId);
      return runFollowUpTick(
        { store: partial.store, interpreter: partial.interpreter, dispatcher: partial.dispatcher, clock: partial.clock },
        session,
        state.policy,
        state.attempts,
        state.snapshot,
        conversationReference,
        state.styleExamples,
      );
    },
  };
}

export function getComposition(): Composition {
  if (!composition) {
    throw new Error(
      "worker composition not configured — call configureComposition() at bootstrap (see src/bootstrap.ts)",
    );
  }
  return composition;
}

export function resetComposition(): void {
  composition = null;
}
