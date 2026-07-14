/**
 * end-to-end trigger→draft→send loop against the FakeProvider — no electron,
 * no socket. proves the mac wiring: a standalone 📅 produces trigger_detected
 * + context_collected device events; a request_approval command surfaces the
 * full draft locally; and a subsequent send_message command actually sends.
 */
import { describe, expect, it } from "vitest";

import type { DeviceEvent, RequestApprovalPayload } from "@soon/realtime-protocol";

import { FakeProvider } from "../imessage/fake-provider.js";
import type { LocalMessage } from "../imessage/types.js";
import { openLocalDatabase } from "../local-database/db.js";
import {
  CursorStore,
  PendingActionStore,
  ReceiptStore,
  SettingsStore,
} from "../local-database/stores.js";
import { createPassthroughBox } from "../secure-storage/index.js";
import { createFakeClock } from "../test-helpers.js";
import { TriggerEngine } from "../main/engine.js";
import { DeviceEventFactory } from "./events.js";
import { CommandProcessor } from "./processor.js";

const BASE = 1_700_000_000_000;
const CONV = "iMessage;-;+15551234567";

const waitFor = async (pred: () => boolean, tries = 40): Promise<void> => {
  for (let i = 0; i < tries; i += 1) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

const harness = () => {
  const clock = createFakeClock(BASE);
  const now = (): number => clock.current();
  const opened = openLocalDatabase(":memory:");
  const settings = new SettingsStore(opened.db);
  settings.init(BASE);
  const cursors = new CursorStore(opened.db);
  const receipts = new ReceiptStore(opened.db);
  const pendingActions = new PendingActionStore(opened.db, createPassthroughBox());
  const provider = new FakeProvider({ now });
  const events = new DeviceEventFactory({
    deviceId: "dev-1",
    nextSequence: () => settings.nextOutboundSequence(),
    now,
  });
  const emitted: DeviceEvent[] = [];
  const emitEvent = (event: DeviceEvent): void => {
    emitted.push(event);
  };
  const approvals: RequestApprovalPayload[] = [];

  const processor = new CommandProcessor({
    provider,
    pendingActions,
    receipts,
    settings,
    events,
    emitEvent,
    requestApproval: (payload) => approvals.push(payload),
    collectContext: async () => {
      throw new Error("collect_context not exercised by this test");
    },
    now,
  });
  const engine = new TriggerEngine({
    provider,
    cursors,
    receipts,
    settings,
    events,
    emitEvent,
    clock,
    now,
  });

  let seq = 0;
  const makeCommand = (
    type: string,
    payload: unknown,
    opts: { expiresInMs?: number; commandId?: string; idempotencyKey?: string } = {},
  ): unknown => {
    seq += 1;
    const commandId = opts.commandId ?? `cmd-${seq}`;
    return {
      protocolVersion: 1,
      commandId,
      deviceId: "cloud",
      sessionId: "sess-1",
      sequenceNumber: seq,
      issuedAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + (opts.expiresInMs ?? 60_000)).toISOString(),
      idempotencyKey: opts.idempotencyKey ?? `idem-${commandId}`,
      signature: "test-signature",
      type,
      payload,
    };
  };

  return { clock, now, provider, engine, processor, emitted, approvals, makeCommand, opened };
};

const userMessage = (text: string, sentAtMs: number): LocalMessage => ({
  ref: `u-${sentAtMs}`,
  conversationRef: CONV,
  text,
  sentAtMs,
  isFromMe: true,
  isGroup: false,
  participantHandles: [],
});

const draftPayload = (now: number): RequestApprovalPayload => ({
  draftId: "draft-1",
  conversationReference: CONV,
  proposedText: "how's tues around 3 or thurs morning?",
  meetingContext: "coffee with alex",
  candidateTimes: [
    { slotId: "s1", label: "tue 3:00 pm" },
    { slotId: "s2", label: "thu 10:00 am" },
  ],
  whySelected: "two open windows this week",
  bundleStatus: { mode: "approve_every" },
  expiresAt: new Date(now + 900_000).toISOString(),
});

describe("trigger → draft → send loop (FakeProvider)", () => {
  it("emits trigger_detected + context_collected, surfaces the draft, then sends", async () => {
    const h = harness();
    // a prior counterparty message so the collected context is meaningful.
    h.provider.seed({
      ref: "m0",
      conversationRef: CONV,
      text: "we should grab coffee this week",
      sentAtMs: BASE - 60_000,
      isFromMe: false,
      isGroup: false,
      participantHandles: ["+15551234567"],
    });

    await h.engine.start();

    // the user drops the standalone trigger.
    h.provider.inject(userMessage("📅", BASE + 1_000));
    // flush the 3s fragment-batch window.
    h.clock.advance(3_100);
    await waitFor(() => h.emitted.some((e) => e.type === "context_collected"));

    const types = h.emitted.map((e) => e.type);
    expect(types).toContain("trigger_detected");
    expect(types).toContain("context_collected");

    // cloud proposes a draft for local approval.
    const payload = draftPayload(h.now());
    const ack = await h.processor.handle(h.makeCommand("request_approval", payload));
    expect(ack.ok).toBe(true);
    expect(h.approvals).toHaveLength(1);
    expect(h.approvals[0]?.proposedText).toBe(payload.proposedText);
    expect(h.approvals[0]?.candidateTimes).toHaveLength(2);

    // user approves in the window → cloud issues the actual send.
    const sendAck = await h.processor.handle(
      h.makeCommand("send_message", {
        conversationReference: CONV,
        text: payload.proposedText,
        draftId: payload.draftId,
        approvalSource: "explicit",
      }),
    );
    expect(sendAck.ok).toBe(true);
    expect(h.provider.sent.map((s) => s.text)).toContain(payload.proposedText);
    expect(h.emitted.some((e) => e.type === "message_sent")).toBe(true);

    await h.engine.stop();
  });

  it("does not surface an expired request_approval", async () => {
    const h = harness();
    const ack = await h.processor.handle(
      h.makeCommand("request_approval", draftPayload(h.now()), { expiresInMs: -1_000 }),
    );
    expect(ack.ok).toBe(false);
    expect(ack.errorCode).toBe("expired");
    expect(h.approvals).toHaveLength(0);
    expect(h.emitted.some((e) => e.type === "command_expired")).toBe(true);
  });

  it("acks a duplicate request_approval without surfacing it twice", async () => {
    const h = harness();
    const payload = draftPayload(h.now());
    const first = await h.processor.handle(
      h.makeCommand("request_approval", payload, { idempotencyKey: "dup-1" }),
    );
    const second = await h.processor.handle(
      h.makeCommand("request_approval", payload, { idempotencyKey: "dup-1" }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(h.approvals).toHaveLength(1);
  });
});
