import { task, wait } from "@trigger.dev/sdk";
import { z } from "zod";

/**
 * one durable run per scheduling session. the run owns every persisted wait
 * (attendee response timeouts, follow-up timers) so nothing depends on
 * in-memory timers, vercel cron alone, or the mac app process.
 *
 * steps call the orchestrator functions in ../propose.ts, ../reply-router.ts,
 * ../confirm.ts, ../follow-up-runner.ts through idempotent activities; the
 * composition root (composition.ts) wires prisma/calendar/gateway adapters.
 */

export const sessionWorkflowInput = z.object({
  sessionId: z.string(),
  userId: z.string(),
  conversationReference: z.string(),
});
export type SessionWorkflowInput = z.infer<typeof sessionWorkflowInput>;

export const schedulingSessionTask = task({
  id: "scheduling-session",
  // one active run per session — retried steps must be idempotent, never duplicated
  queue: { concurrencyLimit: 1 },
  run: async (payload: SessionWorkflowInput, { ctx }) => {
    const { getComposition } = await import("../composition.js");
    const comp = getComposition();
    const log = comp.logger.child({ sessionId: payload.sessionId, runId: ctx.run.id });

    log.info("scheduling session workflow started");

    // the run loops: evaluate current persisted state → perform the next
    // idempotent step → persist → wait for a signal (reply/approval) or a
    // follow-up timer. state lives in postgres, never in this closure.
    let guard = 0;
    while (guard++ < 200) {
      const session = await comp.store.get(payload.sessionId);

      switch (session.state) {
        case "waiting_for_follow_up": {
          if (!session.nextActionAt) {
            log.warn("waiting_for_follow_up without next_action_at; pausing for review");
            await comp.store.transition(session.id, "needs_user_input", { reason: "missing_next_action" });
            break;
          }
          // durable wait — survives deploys, restarts, mac sleep
          await wait.until({ date: new Date(session.nextActionAt) });
          const fresh = await comp.store.get(payload.sessionId);
          // a reply may have arrived while we slept; only mark due if untouched
          if (fresh.state === "waiting_for_follow_up") {
            await comp.store.transition(fresh.id, "follow_up_due");
          }
          break;
        }
        case "follow_up_due": {
          await comp.runFollowUpTick(payload.sessionId, payload.conversationReference);
          break;
        }
        case "scheduled":
        case "expired":
        case "failed":
        case "taken_over":
        case "paused":
          log.info({ state: session.state }, "workflow run parking");
          return { finalState: session.state };
        default: {
          // states advanced by external events (approvals, replies) — park until signaled
          const token = await wait.createToken({
            timeout: "7d",
            idempotencyKey: `signal:${session.id}:${session.updatedAt}`,
          });
          await comp.store.audit(session.id, "workflow_waiting_for_signal", "soon", {
            tokenId: token.id,
            state: session.state,
          });
          const result = await wait.forToken(token);
          if (!result.ok) {
            // timeout — negotiation stalled past the window; pause privately
            await comp.store.transition(session.id, "needs_user_input", { reason: "signal_timeout" });
          }
          break;
        }
      }
    }
    return { finalState: "loop_guard_exhausted" };
  },
});
