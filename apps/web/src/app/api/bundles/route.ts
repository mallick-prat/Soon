import { NextResponse } from "next/server";
import { z } from "zod";
import { createBundle } from "@soon/database";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const bundleObjectiveSchema = z.enum([
  "propose_slots",
  "ask_for_constraint",
  "ask_for_email",
  "clarify_selection",
  "confirm_time",
  "confirm_invite",
  "follow_up",
]);

const createBundleSchema = z.object({
  sessionId: z.string().min(1),
  allowedObjectives: z.array(bundleObjectiveSchema).min(1),
  approvedSlotIds: z.array(z.string()).default([]),
  approvedDateRangeStart: z.iso.date(),
  approvedDateRangeEnd: z.iso.date(),
  minimumDurationMinutes: z.number().int().positive(),
  maximumDurationMinutes: z.number().int().positive(),
  approvedParticipantIds: z.array(z.string()).default([]),
  maximumOutboundMessages: z.number().int().positive().max(10).optional(),
  expiresAtIso: z.iso.datetime().optional(),
});

/** creates an approval bundle ("approve the next few messages at once") */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { data, error } = await parseBody(request, createBundleSchema);
  if (error) return error;
  try {
    const bundle = await createBundle({
      sessionId: data.sessionId,
      allowedObjectives: data.allowedObjectives,
      approvedSlotIds: data.approvedSlotIds,
      approvedDateRangeStart: new Date(data.approvedDateRangeStart),
      approvedDateRangeEnd: new Date(data.approvedDateRangeEnd),
      minimumDurationMinutes: data.minimumDurationMinutes,
      maximumDurationMinutes: data.maximumDurationMinutes,
      approvedParticipantIds: data.approvedParticipantIds,
      ...(data.maximumOutboundMessages !== undefined && {
        maximumOutboundMessages: data.maximumOutboundMessages,
      }),
      ...(data.expiresAtIso !== undefined && { expiresAt: new Date(data.expiresAtIso) }),
    });
    return NextResponse.json({ bundle }, { status: 201 });
  } catch {
    return serverError("bundle creation failed");
  }
}
