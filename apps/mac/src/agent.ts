/**
 * headless soon mac agent — the real companion (enroller, trigger engine,
 * command processor, realtime client) wired against the FakeProvider with a
 * console UI instead of the electron tray / approval window. lets you pair,
 * connect to the gateway, and drive the whole loop from stdin — no Full Disk
 * Access, no Messages, no GUI.
 *
 *   run:  SOON_ENROLLMENT_CODE=<code from dashboard /connections> \
 *         pnpm --filter @soon/mac agent
 *
 * stdin commands:
 *   📅            drop the trigger (uploads context to soon)
 *   <any text>    simulate an incoming imessage from the other person
 *   draft         simulate soon proposing a draft (needs INTERNAL_API_TOKEN +
 *                 DEVICE_SIGNING_SECRET — i.e. acting as the cloud locally)
 *   approve       approve the pending draft (sends it)
 *   reject        decline the pending draft
 */
import readline from "node:readline";

import { signEnvelope } from "@soon/security";
import {
  PROTOCOL_VERSION,
  SOCKET_EVENTS,
  type CloudCommand,
  type RequestApprovalPayload,
} from "@soon/realtime-protocol";

import { collectActivationContext } from "./imessage/context.js";
import { FakeProvider } from "./imessage/fake-provider.js";
import { openLocalDatabase } from "./local-database/db.js";
import { CursorStore, PendingActionStore, ReceiptStore, SettingsStore } from "./local-database/stores.js";
import { DeviceEnroller } from "./enrollment/enroller.js";
import { createSettingsEnrollmentStore } from "./enrollment/store.js";
import { createPassthroughBox } from "./secure-storage/index.js";
import { DeviceEventFactory } from "./realtime/events.js";
import { CommandProcessor } from "./realtime/processor.js";
import { RealtimeClient } from "./realtime/client.js";
import { TriggerEngine } from "./main/engine.js";

const GATEWAY_URL = process.env["SOON_GATEWAY_URL"] ?? "http://localhost:8787";
const DASHBOARD_URL = process.env["SOON_DASHBOARD_URL"] ?? "http://localhost:3100";
const CONVERSATION = "iMessage;-;+15550000000";

async function main(): Promise<void> {
  const opened = openLocalDatabase(process.env["SOON_DB_PATH"] ?? ":memory:");
  const box = createPassthroughBox();
  const settings = new SettingsStore(opened.db);
  settings.init(Date.now());
  const cursors = new CursorStore(opened.db);
  const receipts = new ReceiptStore(opened.db);
  const pendingActions = new PendingActionStore(opened.db, box);

  // ---- pairing ----
  const enroller = new DeviceEnroller({
    store: createSettingsEnrollmentStore(settings, box),
    post: async (path, body) => {
      const res = await fetch(`${DASHBOARD_URL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },
    deviceName: "soon mac agent (headless)",
    appVersion: "0.1.0",
  });

  const code = process.env["SOON_ENROLLMENT_CODE"];
  const envToken = process.env["SOON_DEVICE_TOKEN"];
  if (code !== undefined && code !== "" && !enroller.isEnrolled()) {
    process.stdout.write("pairing with the dashboard… ");
    const { serverDeviceId } = await enroller.register(code);
    console.log(`paired ✓  device ${serverDeviceId}`);
  }
  if (!enroller.isEnrolled() && (envToken === undefined || envToken === "")) {
    console.error(
      "\nnot paired. open the dashboard /connections, click 'pair a mac', copy the code, then:\n" +
        "  SOON_ENROLLMENT_CODE=<code> pnpm --filter @soon/mac agent\n",
    );
    process.exit(1);
  }

  // ---- realtime + engine ----
  const provider = new FakeProvider();
  const events = new DeviceEventFactory({
    deviceId: () => settings.get().deviceId,
    nextSequence: () => settings.nextOutboundSequence(),
  });

  let pendingApproval: RequestApprovalPayload | null = null;
  let realtime!: RealtimeClient;

  const processor = new CommandProcessor({
    provider,
    pendingActions,
    receipts,
    settings,
    events,
    emitEvent: (event) => realtime.emitEvent(event),
    requestApproval: (payload) => {
      pendingApproval = payload;
      console.log("\n┌─ soon wants to send a message ────────────────");
      console.log(`│ to: ${payload.conversationReference}`);
      console.log(`│ "${payload.proposedText}"`);
      if (payload.candidateTimes.length > 0) {
        console.log(`│ times: ${payload.candidateTimes.map((t) => t.label).join("  |  ")}`);
      }
      console.log("└─ type 'approve' to send, 'reject' to decline\n");
    },
    notify: (n) => console.log(`🔔 ${n.title}${n.subtext !== undefined ? ` — ${n.subtext}` : ""}`),
    collectContext: (payload) =>
      collectActivationContext(provider, {
        conversationRef: payload.conversationReference,
        triggerMessageRef: "",
        triggerText: "",
        nowMs: Date.now(),
        maxMessages: payload.maxMessages,
        maxAgeHours: payload.maxAgeHours,
      }),
  });

  realtime = new RealtimeClient({
    url: GATEWAY_URL,
    getToken: () => (envToken !== undefined && envToken !== "" ? envToken : enroller.getAccessToken()),
    processor,
    onStatusChange: (status) => console.log(`gateway: ${status}`),
    log: () => {},
  });

  const engine = new TriggerEngine({
    provider,
    cursors,
    receipts,
    settings,
    events,
    emitEvent: (event) => realtime.emitEvent(event),
    onActivation: (conversationRef) =>
      console.log(`\n📅 trigger detected in ${conversationRef} — uploading context to soon…\n`),
  });

  realtime.connect();
  await engine.start();

  console.log(`\nsoon mac agent running — gateway ${GATEWAY_URL}, device ${settings.get().deviceId}`);
  console.log(
    "commands:  📅 (trigger)   <text> (incoming imessage)   draft (simulate soon)   approve   reject   ctrl-c\n",
  );

  // ---- stdin loop ----
  let seq = 0;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const text = line.trim();
    if (text === "") return;

    if (text === "approve" || text === "reject") {
      void handleDecision(text).catch((e: unknown) => console.error("decision failed:", e));
      return;
    }
    if (text === "draft") {
      void simulateCloudDraft().catch((e: unknown) => console.error("draft sim failed:", e));
      return;
    }

    // 📅 (optionally with a modifier) is a user-authored trigger; anything else
    // is an incoming message from the other person.
    const isTrigger = text.startsWith("📅");
    provider.inject({
      ref: `msg-${++seq}`,
      conversationRef: CONVERSATION,
      text,
      sentAtMs: Date.now(),
      isFromMe: isTrigger,
      isGroup: false,
      participantHandles: isTrigger ? [] : ["+15550000000"],
    });
    if (!isTrigger) console.log(`  ↳ received "${text}" from the other person`);
  });

  async function handleDecision(kind: "approve" | "reject"): Promise<void> {
    if (pendingApproval === null) {
      console.log("  (no draft is waiting)");
      return;
    }
    const draft = pendingApproval;
    pendingApproval = null;
    await realtime.emitEvent(
      events.build("approval_decision", {
        draftId: draft.draftId,
        decision: kind === "approve" ? "send" : "stop",
      }),
    );
    if (kind === "reject") {
      console.log("  ✕ declined — soon won't send it\n");
      return;
    }
    // in production the cloud reacts to approval_decision by issuing send_message;
    // simulate that here so the message actually goes out via the provider.
    await postCommand("send_message", {
      conversationReference: draft.conversationReference,
      text: draft.proposedText,
      draftId: draft.draftId,
      approvalSource: "explicit",
    });
    await new Promise((r) => setTimeout(r, 300));
    const last = provider.sent.at(-1);
    console.log(`  ✉️  sent to ${draft.conversationReference}: "${last?.text ?? draft.proposedText}"\n`);
  }

  async function simulateCloudDraft(): Promise<void> {
    const payload: RequestApprovalPayload = {
      draftId: `draft-${Date.now()}`,
      conversationReference: CONVERSATION,
      proposedText: "how's tuesday around 3, or thursday morning?",
      meetingContext: "catch up",
      candidateTimes: [
        { slotId: "s1", label: "tue 3:00 pm" },
        { slotId: "s2", label: "thu 10:00 am" },
      ],
      whySelected: "two open windows this week",
      bundleStatus: { mode: "approve_every" },
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
    await postCommand("request_approval", payload);
  }

  async function postCommand(type: string, payload: unknown): Promise<void> {
    const token = process.env["INTERNAL_API_TOKEN"];
    const secret = process.env["DEVICE_SIGNING_SECRET"];
    if (token === undefined || secret === undefined) {
      console.log("  (set INTERNAL_API_TOKEN + DEVICE_SIGNING_SECRET to simulate the cloud locally)");
      return;
    }
    const now = Date.now();
    const envelope: Record<string, unknown> = {
      protocolVersion: PROTOCOL_VERSION,
      commandId: `demo-${now}`,
      deviceId: settings.get().deviceId,
      sequenceNumber: now, // monotonic
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60_000).toISOString(),
      idempotencyKey: `demo-${now}`,
      signature: "",
      type,
      payload,
    };
    const signature = signEnvelope(envelope, secret);
    const command: CloudCommand = { ...envelope, signature } as unknown as CloudCommand;
    const res = await fetch(`${GATEWAY_URL}/internal/commands`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(command),
    });
    if (res.status !== 202 && res.status !== 200) {
      console.log(`  cloud sim POST failed: ${res.status}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error("agent failed:", error);
  process.exit(1);
});
