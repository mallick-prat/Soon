import type { DurableWorkflowClient } from "./types.js";

/**
 * production trigger.dev-backed implementation.
 *
 * this lands in apps/worker: the worker owns the trigger.dev project, task
 * definitions (session negotiation loop, durable wait.until timers,
 * wait-for-signal on attendee replies), and the api key. it will implement
 * {@link DurableWorkflowClient} by mapping:
 *   - startSessionWorkflow → tasks.trigger("session-workflow", input)
 *   - cancelRun            → runs.cancel(runId)
 *   - signalReplyReceived  → wait-token / realtime signal completion
 *   - scheduleWakeup       → wait.until inside the task, driven by run metadata
 *   - getRunStatus         → runs.retrieve(runId).status mapped onto WorkflowRunStatus
 *
 * kept here as a documented stub so callers already depend on the factory
 * shape; it throws until apps/worker wires it up.
 */
export function createTriggerDevClient(): DurableWorkflowClient {
  throw new Error(
    "trigger.dev workflow client is not wired yet — implemented in apps/worker; use InMemoryWorkflowClient for tests and local dev",
  );
}
