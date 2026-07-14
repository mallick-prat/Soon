import { describe, expect, it } from "vitest";
import { InMemoryWorkflowClient, createTriggerDevClient } from "./index.js";

const baseInput = {
  sessionId: "sess-1",
  userId: "user-1",
  conversationId: "conv-1",
  timezone: "America/New_York",
};

const t = (minutes: number) => new Date(minutes * 60_000);

describe("InMemoryWorkflowClient", () => {
  it("starts a run and reports running status", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow(baseInput);
    expect(runId).toBe("run_1");
    expect(await client.getRunStatus(runId)).toBe("running");
    expect(client.log[0]).toMatchObject({ type: "run_started", runId, sessionId: "sess-1" });
  });

  it("validates start input with zod", async () => {
    const client = new InMemoryWorkflowClient();
    await expect(
      client.startSessionWorkflow({ ...baseInput, sessionId: "" }),
    ).rejects.toThrow();
  });

  it("fires wakeups in chronological order regardless of scheduling order", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId: a } = await client.startSessionWorkflow(baseInput);
    const { runId: b } = await client.startSessionWorkflow({ ...baseInput, sessionId: "sess-2" });
    await client.scheduleWakeup(a, t(30));
    await client.scheduleWakeup(b, t(10));
    await client.scheduleWakeup(a, t(20));
    const fired = client.advanceTo(t(60));
    expect(fired).toEqual([b, a, a]);
  });

  it("uses insertion order to break ties at the same instant", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId: a } = await client.startSessionWorkflow(baseInput);
    const { runId: b } = await client.startSessionWorkflow({ ...baseInput, sessionId: "sess-2" });
    await client.scheduleWakeup(b, t(10));
    await client.scheduleWakeup(a, t(10));
    expect(client.advanceTo(t(10))).toEqual([b, a]);
  });

  it("only fires wakeups that are due, and never re-fires them", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow(baseInput);
    await client.scheduleWakeup(runId, t(10));
    await client.scheduleWakeup(runId, t(50));
    expect(client.advanceTo(t(20))).toEqual([runId]);
    expect(client.advanceTo(t(20))).toEqual([]);
    expect(client.pendingWakeups(runId)).toHaveLength(1);
    expect(client.advanceTo(t(50))).toEqual([runId]);
  });

  it("waiting status flips back to running when a wakeup fires", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow(baseInput);
    await client.scheduleWakeup(runId, t(5));
    expect(await client.getRunStatus(runId)).toBe("waiting");
    client.advanceTo(t(5));
    expect(await client.getRunStatus(runId)).toBe("running");
  });

  it("cancellation cascades: pending wakeups never fire after cancelRun", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId: a } = await client.startSessionWorkflow(baseInput);
    const { runId: b } = await client.startSessionWorkflow({ ...baseInput, sessionId: "sess-2" });
    await client.scheduleWakeup(a, t(10));
    await client.scheduleWakeup(a, t(20));
    await client.scheduleWakeup(b, t(15));
    await client.cancelRun(a);
    expect(await client.getRunStatus(a)).toBe("cancelled");
    expect(client.pendingWakeups(a)).toHaveLength(0);
    expect(client.advanceTo(t(60))).toEqual([b]);
    expect(client.log.filter((e) => e.type === "wakeup_cancelled")).toHaveLength(2);
  });

  it("cancelled runs reject new wakeups and signals", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow(baseInput);
    await client.cancelRun(runId);
    await expect(client.scheduleWakeup(runId, t(10))).rejects.toThrow(/cancelled/);
    await expect(client.signalReplyReceived(runId, "msg-1")).rejects.toThrow(/cancelled/);
  });

  it("signalReplyReceived cancels pending wakeups and wakes the run", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow(baseInput);
    await client.scheduleWakeup(runId, t(30));
    expect(await client.getRunStatus(runId)).toBe("waiting");
    await client.signalReplyReceived(runId, "msg-abc");
    expect(await client.getRunStatus(runId)).toBe("running");
    expect(client.pendingWakeups(runId)).toHaveLength(0);
    expect(client.advanceTo(t(60))).toEqual([]);
    expect(client.log).toContainEqual(
      expect.objectContaining({ type: "signal_received", runId, messageRef: "msg-abc" }),
    );
  });

  it("schedules the initial wakeup from start input", async () => {
    const client = new InMemoryWorkflowClient();
    const { runId } = await client.startSessionWorkflow({
      ...baseInput,
      initialWakeupAt: t(15).toISOString(),
    });
    expect(await client.getRunStatus(runId)).toBe("waiting");
    expect(client.advanceTo(t(15))).toEqual([runId]);
  });

  it("refuses to move the clock backwards and reports unknown runs", async () => {
    const client = new InMemoryWorkflowClient({ now: t(100) });
    expect(() => client.advanceTo(t(50))).toThrow(/backwards/);
    await expect(client.getRunStatus("run_missing")).rejects.toThrow(/unknown run/);
  });

  it("invokes the onWakeup callback for every fired wakeup", async () => {
    const fired: string[] = [];
    const client = new InMemoryWorkflowClient({ onWakeup: (runId) => fired.push(runId) });
    const { runId } = await client.startSessionWorkflow(baseInput);
    await client.scheduleWakeup(runId, t(1));
    await client.scheduleWakeup(runId, t(2));
    client.advanceTo(t(5));
    expect(fired).toEqual([runId, runId]);
  });
});

describe("createTriggerDevClient", () => {
  it("throws a documented not-wired-yet error", () => {
    expect(() => createTriggerDevClient()).toThrow(/not wired yet/);
  });
});
