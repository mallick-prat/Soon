import { z } from "zod";

/**
 * lifecycle of a durable workflow run, mirroring the workflow_runs table:
 * queued → running → waiting (reply or wakeup) → completed | cancelled | failed | expired.
 */
export const workflowRunStatusSchema = z.enum([
  "queued",
  "running",
  "waiting",
  "completed",
  "cancelled",
  "failed",
  "expired",
]);
export type WorkflowRunStatus = z.infer<typeof workflowRunStatusSchema>;

/** input for kicking off a scheduling-session workflow */
export const startSessionWorkflowInputSchema = z.object({
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  conversationId: z.string().min(1),
  /** iana timezone the session negotiates in */
  timezone: z.string().min(1),
  /** optional first wakeup (iso instant) — e.g. the initial follow-up check */
  initialWakeupAt: z.string().optional(),
});
export type StartSessionWorkflowInput = z.infer<typeof startSessionWorkflowInputSchema>;

/**
 * provider-agnostic durable-workflow client. the scheduling engine depends on
 * this interface only — never on trigger.dev (or any other provider) directly.
 */
export interface DurableWorkflowClient {
  /** start a new durable run for a scheduling session */
  startSessionWorkflow(input: StartSessionWorkflowInput): Promise<{ runId: string }>;
  /** cancel a run and everything it is waiting on */
  cancelRun(runId: string): Promise<void>;
  /** signal that an attendee reply arrived; wakes the run and cancels pending timers */
  signalReplyReceived(runId: string, messageRef: string): Promise<void>;
  /** schedule a durable timer that wakes the run at the given instant */
  scheduleWakeup(runId: string, at: Date): Promise<void>;
  /** current status of a run */
  getRunStatus(runId: string): Promise<WorkflowRunStatus>;
}
