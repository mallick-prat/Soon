/**
 * inbound device-event orchestration — the autonomous entry to scheduling.
 * when the mac uploads context after a 📅 (context_collected), this resolves
 * the user + conversation, creates a scheduling session, interprets the thread,
 * and runs a full proposal round (real calendar free/busy + llm draft) which
 * enqueues a request_approval command back to the device via the outbox.
 */
import { createHash } from "node:crypto";

import type { DeviceEvent } from "@soon/realtime-protocol";
import { activationContextSchema, type ActivationContext, type WorkingHours } from "@soon/shared-types";
import { createSessionFromTrigger, findActiveSessionByConversation, getDb } from "@soon/database";

import type { Composition } from "./composition.js";
import { runProposalRound } from "./propose.js";

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

/**
 * handle one inbound device event. only context_collected drives scheduling
 * today; other events are acknowledged as no-ops.
 */
export async function handleDeviceEvent(
  event: DeviceEvent,
  comp: Composition,
): Promise<DeviceEventOutcome> {
  if (event.type !== "context_collected") return { handled: false };

  const db = getDb();
  const device = await db.macDevice.findUnique({ where: { id: event.deviceId } });
  if (device === null) {
    comp.logger.warn({ deviceId: event.deviceId }, "context from unknown device — ignoring");
    return { handled: false };
  }
  const userId = device.userId;
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
  const now = comp.clock.now();
  const minimumNoticeMinutes = prefs?.minimumNoticeMinutes ?? 120;
  const result = await runProposalRound(
    comp,
    session,
    {
      rangeStart: new Date(now.getTime() + minimumNoticeMinutes * 60_000),
      rangeEnd: new Date(now.getTime() + 7 * DAY_MS),
      durationMinutes: session.durationMinutes,
      timezone,
      workingHours: readWorkingHours(prefs?.workingHoursJson),
      minimumNoticeMinutes,
      ...(prefs?.bufferBeforeMinutes ? { bufferBeforeMinutes: prefs.bufferBeforeMinutes } : {}),
      ...(prefs?.bufferAfterMinutes ? { bufferAfterMinutes: prefs.bufferAfterMinutes } : {}),
    },
    [],
    ctx.conversationReference,
  );

  comp.logger.info(
    { sessionId: session.id, outcome: result.outcome, slots: result.slots.length },
    "proposal round complete",
  );
  return { handled: true, sessionId: session.id, outcome: result.outcome };
}
