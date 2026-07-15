/**
 * inbound device-event orchestration — the autonomous heart of soon.
 *
 * three device events drive the whole scheduling loop:
 * - context_collected (after a 📅): resolve user + conversation, create a
 *   session, interpret the thread, run a proposal round (real free/busy + llm
 *   draft) → request_approval back to the mac.
 * - approval_decision: the user acted on that draft. send/edit issues the
 *   actual send_message; stop/take_over parks the session; another re-rolls.
 * - inbound_message: the attendee replied. interpret (llm), route
 *   (deterministic), then confirm the slot + create the calendar event, run a
 *   new round, or hand back to the user.
 */
import { createHash } from "node:crypto";

import type { DeviceEvent } from "@soon/realtime-protocol";
import {
  activationContextSchema,
  type ActivationContext,
  type CandidateSlot,
  type SchedulingSession,
  type WorkingHours,
} from "@soon/shared-types";
import {
  approveDraft,
  createSessionFromTrigger,
  findActiveSessionByConversation,
  getDb,
  rejectDraft,
} from "@soon/database";
import { canTransition } from "@soon/scheduling-engine";

import type { Composition } from "./composition.js";
import { confirmAndCreateEvent } from "./confirm.js";
import { runProposalRound } from "./propose.js";
import { routeReply } from "./reply-router.js";

const DAY_MS = 86_400_000;
const DEFAULT_WORKING_HOURS: WorkingHours[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  start: "09:00",
  end: "18:00",
}));

export interface DeviceEventOutcome {
  handled: boolean;
  sessionId?: string;
  outcome?: string;
}

function participantHash(ctx: ActivationContext): string {
  const handles = ctx.participants
    .filter((p) => !p.isUser)
    .map((p) => p.handle.trim().toLowerCase())
    .sort()
    .join(",");
  return createHash("sha256").update(handles).digest("hex").slice(0, 32);
}

function readWorkingHours(value: unknown): WorkingHours[] {
  if (Array.isArray(value) && value.length > 0) return value as WorkingHours[];
  return DEFAULT_WORKING_HOURS;
}

/** resolve which user owns the device an event came from, or null if unknown. */
async function resolveDeviceUser(deviceId: string, comp: Composition): Promise<string | null> {
  const device = await getDb().macDevice.findUnique({ where: { id: deviceId } });
  if (device === null) {
    comp.logger.warn({ deviceId }, "event from unknown device — ignoring");
    return null;
  }
  return device.userId;
}

/** build the slot-generation input for a session from the user's preferences. */
async function proposalInputFor(session: SchedulingSession, comp: Composition) {
  const prefs = await getDb().calendarPreference.findUnique({ where: { userId: session.userId } });
  const timezone = prefs?.timezone ?? session.timezone;
  const now = comp.clock.now();
  const minimumNoticeMinutes = prefs?.minimumNoticeMinutes ?? 120;
  return {
    input: {
      rangeStart: new Date(now.getTime() + minimumNoticeMinutes * 60_000),
      rangeEnd: new Date(now.getTime() + 7 * DAY_MS),
      durationMinutes: session.durationMinutes,
      timezone,
      workingHours: readWorkingHours(prefs?.workingHoursJson),
      minimumNoticeMinutes,
      ...(prefs?.bufferBeforeMinutes ? { bufferBeforeMinutes: prefs.bufferBeforeMinutes } : {}),
      ...(prefs?.bufferAfterMinutes ? { bufferAfterMinutes: prefs.bufferAfterMinutes } : {}),
    },
    timezone,
  };
}

/**
 * handle one inbound device event. context_collected starts a session,
 * approval_decision resolves a parked draft, inbound_message advances the
 * conversation; everything else is acknowledged as a no-op.
 */
export async function handleDeviceEvent(
  event: DeviceEvent,
  comp: Composition,
): Promise<DeviceEventOutcome> {
  switch (event.type) {
    case "context_collected":
      return handleContextCollected(event, comp);
    case "approval_decision":
      return handleApprovalDecision(event, comp);
    case "inbound_message":
      return handleInboundMessage(event, comp);
    default:
      return { handled: false };
  }
}

async function handleContextCollected(
  event: Extract<DeviceEvent, { type: "context_collected" }>,
  comp: Composition,
): Promise<DeviceEventOutcome> {
  const db = getDb();
  const userId = await resolveDeviceUser(event.deviceId, comp);
  if (userId === null) return { handled: false };
  const ctx = activationContextSchema.parse(event.payload.context);

  const conversation = await db.conversation.upsert({
    where: {
      userId_localConversationReference: {
        userId,
        localConversationReference: ctx.conversationReference,
      },
    },
    update: {},
    create: {
      userId,
      localConversationReference: ctx.conversationReference,
      participantHash: participantHash(ctx),
      conversationType: ctx.isGroup ? "group" : "direct",
    },
  });

  const prefs = await db.calendarPreference.findUnique({ where: { userId } });
  const timezone = prefs?.timezone ?? "America/New_York";

  let sessionRow = await findActiveSessionByConversation(conversation.id);
  if (sessionRow === null) {
    const interpreted = await comp.interpreter.interpretContext(ctx);
    sessionRow = await createSessionFromTrigger({
      userId,
      conversationId: conversation.id,
      triggerMessageReference: ctx.triggerMessageReference,
      timezone,
      ...(interpreted.meetingType !== undefined ? { meetingType: interpreted.meetingType } : {}),
      ...(interpreted.durationMinutes !== undefined
        ? { durationMinutes: interpreted.durationMinutes }
        : {}),
      ...(interpreted.format !== "unspecified" ? { meetingFormat: interpreted.format } : {}),
      sensitive: interpreted.sensitive,
    });
    const attendee = ctx.participants.find((p) => !p.isUser);
    if (attendee !== undefined) {
      await db.sessionParticipant
        .create({
          data: {
            sessionId: sessionRow.id,
            handle: attendee.handle,
            ...(attendee.displayName !== undefined ? { displayName: attendee.displayName } : {}),
          },
        })
        .catch(() => undefined);
    }
    comp.logger.info({ sessionId: sessionRow.id, userId }, "session created from trigger");
  }

  const session = await comp.store.get(sessionRow.id);
  const { input } = await proposalInputFor(session, comp);
  const result = await runProposalRound(comp, session, input, [], ctx.conversationReference);

  comp.logger.info(
    { sessionId: session.id, outcome: result.outcome, slots: result.slots.length },
    "proposal round complete",
  );
  return { handled: true, sessionId: session.id, outcome: result.outcome };
}

// ---------------------------------------------------------------------------
// approval_decision — the user acted on a parked draft
// ---------------------------------------------------------------------------

async function handleApprovalDecision(
  event: Extract<DeviceEvent, { type: "approval_decision" }>,
  comp: Composition,
): Promise<DeviceEventOutcome> {
  const db = getDb();
  const userId = await resolveDeviceUser(event.deviceId, comp);
  if (userId === null) return { handled: false };

  const { draftId, decision, editedText } = event.payload;
  const draft = await db.outboundDraft.findUnique({
    where: { id: draftId },
    include: { session: { include: { conversation: true } } },
  });
  if (draft === null || draft.session.userId !== userId) {
    comp.logger.warn({ draftId }, "approval decision for unknown or foreign draft — ignoring");
    return { handled: false };
  }
  if (draft.status !== "pending") {
    // duplicate decision (retransmit) — the first one already settled it.
    return { handled: true, sessionId: draft.sessionId, outcome: `already_${draft.status}` };
  }
  const sessionId = draft.sessionId;
  const conversationReference = draft.session.conversation.localConversationReference;

  switch (decision) {
    case "send":
    case "edit": {
      const text = decision === "edit" && editedText !== undefined ? editedText : draft.text;
      await approveDraft(draftId, {
        approvalSource: "imessage",
        ...(decision === "edit" && editedText !== undefined ? { editedText } : {}),
      });
      await comp.store.transition(sessionId, "sending_approved_message", {
        approvalSource: "explicit",
      });
      await comp.dispatcher.enqueueSend({
        userId,
        sessionId,
        conversationReference,
        draftId,
        text,
        approvalSource: "explicit",
        idempotencyKey: `send:${draftId}`,
        expiresAtIso: draft.expiresAt.toISOString(),
      });
      await comp.store.recordOutbound(sessionId, draftId);
      await comp.store.transition(sessionId, "waiting_for_attendee");
      await comp.store.audit(sessionId, "draft_approved_and_sent", "user", { draftId, decision });
      return { handled: true, sessionId, outcome: "sent" };
    }
    case "another": {
      // user wants different options — reject this draft and re-roll.
      await rejectDraft(draftId, "user_requested_another");
      const session = await comp.store.get(sessionId);
      const { input } = await proposalInputFor(session, comp);
      const result = await runProposalRound(comp, session, input, [], conversationReference);
      return { handled: true, sessionId, outcome: result.outcome };
    }
    case "take_over": {
      await rejectDraft(draftId, "user_took_over");
      await comp.store.transition(sessionId, "taken_over");
      await comp.store.audit(sessionId, "user_took_over", "user", { draftId });
      return { handled: true, sessionId, outcome: "taken_over" };
    }
    case "stop": {
      await rejectDraft(draftId, "user_stopped");
      await comp.store.transition(sessionId, "paused", { reason: "user_stopped" });
      await comp.store.audit(sessionId, "user_stopped_session", "user", { draftId });
      return { handled: true, sessionId, outcome: "stopped" };
    }
  }
}

// ---------------------------------------------------------------------------
// inbound_message — the attendee replied while a session is active
// ---------------------------------------------------------------------------

async function handleInboundMessage(
  event: Extract<DeviceEvent, { type: "inbound_message" }>,
  comp: Composition,
): Promise<DeviceEventOutcome> {
  const db = getDb();
  const userId = await resolveDeviceUser(event.deviceId, comp);
  if (userId === null) return { handled: false };
  const { conversationReference, localMessageReference, text, sentAt, senderIsUser } =
    event.payload;
  // the user's own messages never advance the machine (a manual reply is a
  // follow-up signal, not an attendee response).
  if (senderIsUser) return { handled: false };

  const conversation = await db.conversation.findUnique({
    where: {
      userId_localConversationReference: { userId, localConversationReference: conversationReference },
    },
  });
  if (conversation === null) return { handled: false };
  const sessionRow = await findActiveSessionByConversation(conversation.id);
  if (sessionRow === null) return { handled: false };
  const sessionId = sessionRow.id;

  // idempotent record of the attendee message.
  await db.sessionMessage.upsert({
    where: { sessionId_localMessageReference: { sessionId, localMessageReference } },
    update: {},
    create: {
      sessionId,
      localMessageReference,
      senderType: "attendee",
      direction: "inbound",
      rawText: text,
      sanitizedText: text,
      messageTimestamp: new Date(sentAt),
    },
  });

  const session = await comp.store.get(sessionId);
  // a reply can land while the session is parked (needs_user_input, paused…);
  // record it — the user sees it in Messages — but don't route from a state
  // the machine can't interpret from.
  if (!canTransition(session.state, "interpreting_response")) {
    comp.logger.info(
      { sessionId, state: session.state },
      "inbound recorded but session is not awaiting a reply",
    );
    return { handled: true, sessionId, outcome: "recorded_only" };
  }
  await comp.store.transition(sessionId, "interpreting_response");

  // proposed slots from the latest round + the last thing soon said.
  const slotRows = await db.candidateSlot.findMany({
    where: { sessionId, status: { in: ["candidate", "proposed", "accepted"] } },
    orderBy: { startsAt: "asc" },
  });
  const slots: CandidateSlot[] = slotRows.map((s) => ({
    id: s.id,
    sessionId: s.sessionId,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    timezone: s.timezone,
    status: s.status,
    score: s.score,
    proposalRound: s.proposalRound,
  }));
  const lastDraft = await db.outboundDraft.findFirst({
    where: { sessionId, status: { in: ["sent", "approved"] } },
    orderBy: { createdAt: "desc" },
  });

  const parsed = await comp.interpreter.interpretReply({
    sessionId,
    replyText: text,
    proposedSlots: slots,
    lastOutboundText: lastDraft?.editedText ?? lastDraft?.text ?? "",
  });
  await db.sessionMessage.update({
    where: { sessionId_localMessageReference: { sessionId, localMessageReference } },
    data: { interpretationJson: parsed },
  });

  const participant = await db.sessionParticipant.findFirst({ where: { sessionId } });
  const route = routeReply(session, parsed, slots, participant?.email != null);
  comp.logger.info(
    { sessionId, intent: parsed.intent, action: route.action.kind, nextState: route.nextState },
    "attendee reply routed",
  );

  switch (route.action.kind) {
    case "confirm_slot": {
      const { slotId } = route.action;
      const accepted = slots.find((s) => s.id === slotId);
      if (accepted === undefined || participant?.email == null) {
        await comp.store.transition(sessionId, "needs_user_input", { reason: "confirm_precondition" });
        return { handled: true, sessionId, outcome: "needs_user_input" };
      }
      const firstName = (participant.displayName ?? "there").split(" ")[0] ?? "there";
      const result = await confirmAndCreateEvent(
        comp,
        session,
        accepted,
        { email: participant.email, firstName },
        conversation.id,
        conversationReference,
      );
      if (result.outcome === "slot_taken") {
        const { input } = await proposalInputFor(session, comp);
        const round = await runProposalRound(comp, session, input, [], conversationReference);
        return { handled: true, sessionId, outcome: `slot_taken_reproposed_${round.outcome}` };
      }
      return { handled: true, sessionId, outcome: "scheduled" };
    }
    case "record_email": {
      if (participant !== null) {
        await db.sessionParticipant.update({
          where: { id: participant.id },
          data: { email: route.action.email, respondedAt: new Date() },
        });
      }
      // an accepted slot from the earlier "yes" is waiting on this email.
      const accepted = slots.find((s) => s.status === "accepted");
      if (accepted !== undefined && participant !== null) {
        const firstName = (participant.displayName ?? "there").split(" ")[0] ?? "there";
        const result = await confirmAndCreateEvent(
          comp,
          session,
          accepted,
          { email: route.action.email, firstName },
          conversation.id,
          conversationReference,
        );
        return {
          handled: true,
          sessionId,
          outcome: result.outcome === "created" ? "scheduled" : "slot_taken",
        };
      }
      await comp.store.transition(sessionId, route.nextState);
      return { handled: true, sessionId, outcome: "email_recorded" };
    }
    case "ask_email": {
      // remember which slot they said yes to, then park for the email.
      if (parsed.acceptedSlotId !== undefined) {
        await comp.store.markSlotsStatus(sessionId, [parsed.acceptedSlotId], "accepted");
      }
      await comp.store.transition(sessionId, "waiting_for_email");
      await comp.dispatcher.notify(
        session.userId,
        "need their email",
        "they said yes — soon needs an email address for the invite",
        ["review", "take over"],
      );
      return { handled: true, sessionId, outcome: "waiting_for_email" };
    }
    case "new_round": {
      // the offered slots are dead — never re-offer them — and the attendee's
      // stated constraints ("early next week") shape the next round.
      await comp.store.markSlotsStatus(sessionId, slots.map((s) => s.id), "rejected");
      await comp.store.transition(sessionId, "finding_alternative_slots");
      const { input } = await proposalInputFor(session, comp);
      const constraints = route.action.constraints;
      if (constraints?.earliestDate !== undefined) {
        // keep a full week of options past the requested start.
        const earliest = Date.parse(constraints.earliestDate);
        if (Number.isFinite(earliest) && earliest + 7 * DAY_MS > input.rangeEnd.getTime()) {
          input.rangeEnd = new Date(earliest + 7 * DAY_MS);
        }
      }
      const result = await runProposalRound(
        comp,
        session,
        {
          ...input,
          rejectedSlots: slots.map((s) => ({
            start: Date.parse(s.startsAt),
            end: Date.parse(s.endsAt),
          })),
          ...(constraints !== undefined ? { attendeeConstraints: constraints } : {}),
        },
        [],
        conversationReference,
      );
      return { handled: true, sessionId, outcome: result.outcome };
    }
    case "reschedule":
    case "cancel":
    case "pause_for_user": {
      const reason = route.action.kind === "pause_for_user" ? route.action.reason : route.action.kind;
      await comp.store.transition(sessionId, route.nextState, { reason });
      await comp.dispatcher.notify(
        session.userId,
        "this one needs you",
        `their reply needs your judgment (${reason.replaceAll("_", " ")})`,
        ["review", "take over", "stop"],
      );
      await comp.store.audit(sessionId, "paused_for_user", "soon", { reason });
      return { handled: true, sessionId, outcome: "needs_user_input" };
    }
    case "ignore":
      await comp.store.transition(sessionId, route.nextState);
      return { handled: true, sessionId, outcome: "ignored" };
  }
}
