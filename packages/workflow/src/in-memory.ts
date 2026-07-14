import {
  startSessionWorkflowInputSchema,
  type DurableWorkflowClient,
  type StartSessionWorkflowInput,
  type WorkflowRunStatus,
} from "./types.js";

interface PendingWakeup {
  runId: string;
  at: Date;
  /** insertion order tiebreaker for wakeups due at the same instant */
  seq: number;
  cancelled: boolean;
}

export type WorkflowLogEntry =
  | { type: "run_started"; runId: string; sessionId: string; at: Date }
  | { type: "wakeup_scheduled"; runId: string; at: Date }
  | { type: "wakeup_fired"; runId: string; at: Date }
  | { type: "wakeup_cancelled"; runId: string; at: Date }
  | { type: "signal_received"; runId: string; messageRef: string; at: Date }
  | { type: "run_cancelled"; runId: string; at: Date };

export interface InMemoryWorkflowClientOptions {
  /** starting instant for the manual test clock (defaults to epoch) */
  now?: Date;
  /** called synchronously whenever a wakeup fires during advanceTo */
  onWakeup?: (runId: string, at: Date) => void;
}

/**
 * in-memory {@link DurableWorkflowClient} for tests and local dev.
 * no setTimeout anywhere — time only moves when {@link advanceTo} is called,
 * which fires due wakeups in chronological (then insertion) order. every
 * start/wait/signal/cancel is recorded in {@link log} for observability
 * assertions.
 */
export class InMemoryWorkflowClient implements DurableWorkflowClient {
  readonly log: WorkflowLogEntry[] = [];

  private runs = new Map<
    string,
    { status: WorkflowRunStatus; input: StartSessionWorkflowInput }
  >();
  private wakeups: PendingWakeup[] = [];
  private clock: Date;
  private nextSeq = 0;
  private nextRunNumber = 1;
  private readonly onWakeup: ((runId: string, at: Date) => void) | undefined;

  constructor(options: InMemoryWorkflowClientOptions = {}) {
    this.clock = options.now ?? new Date(0);
    this.onWakeup = options.onWakeup;
  }

  now(): Date {
    return new Date(this.clock.getTime());
  }

  async startSessionWorkflow(input: StartSessionWorkflowInput): Promise<{ runId: string }> {
    const parsed = startSessionWorkflowInputSchema.parse(input);
    const runId = `run_${this.nextRunNumber++}`;
    this.runs.set(runId, { status: "running", input: parsed });
    this.log.push({ type: "run_started", runId, sessionId: parsed.sessionId, at: this.now() });
    if (parsed.initialWakeupAt !== undefined) {
      await this.scheduleWakeup(runId, new Date(parsed.initialWakeupAt));
    }
    return { runId };
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.requireRun(runId);
    if (run.status === "completed" || run.status === "cancelled") return;
    run.status = "cancelled";
    this.cancelPendingWakeups(runId);
    this.log.push({ type: "run_cancelled", runId, at: this.now() });
  }

  async signalReplyReceived(runId: string, messageRef: string): Promise<void> {
    const run = this.requireRun(runId);
    if (run.status === "cancelled" || run.status === "completed") {
      throw new Error(`run ${runId} is ${run.status} and cannot receive signals`);
    }
    // a reply supersedes any pending timers — the run wakes now instead
    this.cancelPendingWakeups(runId);
    run.status = "running";
    this.log.push({ type: "signal_received", runId, messageRef, at: this.now() });
  }

  async scheduleWakeup(runId: string, at: Date): Promise<void> {
    const run = this.requireRun(runId);
    if (run.status === "cancelled" || run.status === "completed") {
      throw new Error(`run ${runId} is ${run.status} and cannot schedule wakeups`);
    }
    run.status = "waiting";
    this.wakeups.push({ runId, at: new Date(at.getTime()), seq: this.nextSeq++, cancelled: false });
    this.log.push({ type: "wakeup_scheduled", runId, at: new Date(at.getTime()) });
  }

  async getRunStatus(runId: string): Promise<WorkflowRunStatus> {
    return this.requireRun(runId).status;
  }

  /**
   * manual test clock: move time forward to `date`, firing every non-cancelled
   * wakeup due at or before it, in chronological then insertion order.
   * returns the runIds fired, in order.
   */
  advanceTo(date: Date): string[] {
    if (date.getTime() < this.clock.getTime()) {
      throw new Error("advanceTo cannot move the clock backwards");
    }
    const due = this.wakeups
      .filter((w) => !w.cancelled && w.at.getTime() <= date.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq);
    const fired: string[] = [];
    for (const wakeup of due) {
      // a wakeup fired earlier in this advance may have cancelled later ones
      if (wakeup.cancelled) continue;
      wakeup.cancelled = true;
      this.clock = new Date(wakeup.at.getTime());
      const run = this.runs.get(wakeup.runId);
      if (!run || run.status === "cancelled" || run.status === "completed") continue;
      run.status = "running";
      this.log.push({ type: "wakeup_fired", runId: wakeup.runId, at: new Date(wakeup.at.getTime()) });
      fired.push(wakeup.runId);
      this.onWakeup?.(wakeup.runId, new Date(wakeup.at.getTime()));
    }
    this.clock = new Date(date.getTime());
    this.wakeups = this.wakeups.filter((w) => !w.cancelled);
    return fired;
  }

  /** test helper: mark a run completed (the real engine does this at terminal states) */
  completeRun(runId: string): void {
    const run = this.requireRun(runId);
    run.status = "completed";
    this.cancelPendingWakeups(runId);
  }

  /** pending (non-cancelled) wakeups, soonest first — handy in tests */
  pendingWakeups(runId?: string): Array<{ runId: string; at: Date }> {
    return this.wakeups
      .filter((w) => !w.cancelled && (runId === undefined || w.runId === runId))
      .sort((a, b) => a.at.getTime() - b.at.getTime() || a.seq - b.seq)
      .map((w) => ({ runId: w.runId, at: new Date(w.at.getTime()) }));
  }

  private cancelPendingWakeups(runId: string): void {
    for (const wakeup of this.wakeups) {
      if (wakeup.runId === runId && !wakeup.cancelled) {
        wakeup.cancelled = true;
        this.log.push({ type: "wakeup_cancelled", runId, at: new Date(wakeup.at.getTime()) });
      }
    }
    this.wakeups = this.wakeups.filter((w) => !w.cancelled);
  }

  private requireRun(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`unknown run ${runId}`);
    return run;
  }
}
