import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@soon/database";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";
import { loadPreferences } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await loadPreferences();
  return NextResponse.json(result);
}

const workingHoursSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const updatePreferencesSchema = z.object({
  timezone: z.string().min(1).optional(),
  approvalMode: z.enum(["approve_every", "bundle", "calendar_only"]).optional(),
  triggerEmoji: z.string().min(1).max(8).optional(),
  followUpDefaultEnabled: z.boolean().optional(),
  calendar: z
    .object({
      destinationCalendarId: z.string().optional(),
      blockingCalendarIds: z.array(z.string()).optional(),
      minimumNoticeMinutes: z.number().int().nonnegative().optional(),
      maximumMeetingsPerDay: z.number().int().positive().optional(),
      weekendEnabled: z.boolean().optional(),
      videoDefault: z.enum(["meet", "none"]).optional(),
      workingHours: z.array(workingHoursSchema).optional(),
      followUpDelaysHours: z.array(z.number().positive()).max(5).optional(),
      quietHours: z
        .object({
          earliest: z.string().regex(/^\d{2}:\d{2}$/),
          latest: z.string().regex(/^\d{2}:\d{2}$/),
        })
        .optional(),
    })
    .optional(),
  style: z
    .object({
      mode: z.enum(["adaptive", "fixed"]).optional(),
      formality: z.string().max(40).optional(),
      emojiEnabled: z.boolean().optional(),
      customInstructions: z.string().max(1000).optional(),
    })
    .optional(),
});

export async function PUT(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { data, error } = await parseBody(request, updatePreferencesSchema);
  if (error) return error;
  try {
    const db = getDb();
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) return NextResponse.json({ error: "no user" }, { status: 409 });

    await db.user.update({
      where: { id: user.id },
      data: {
        ...(data.timezone !== undefined && { timezone: data.timezone }),
        ...(data.approvalMode !== undefined && { approvalMode: data.approvalMode }),
        ...(data.followUpDefaultEnabled !== undefined && {
          followUpDefaultEnabled: data.followUpDefaultEnabled,
        }),
        ...(data.triggerEmoji !== undefined && data.triggerEmoji !== user.triggerEmoji
          ? {
              triggerEmoji: data.triggerEmoji,
              previousTriggerEmoji: user.triggerEmoji,
              // the previous emoji keeps working for 7 days
              previousTriggerExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            }
          : {}),
      },
    });

    if (data.calendar) {
      const c = data.calendar;
      const calendarData = {
        ...(c.destinationCalendarId !== undefined && {
          destinationCalendarId: c.destinationCalendarId,
        }),
        ...(c.blockingCalendarIds !== undefined && {
          blockingCalendarIds: c.blockingCalendarIds,
        }),
        ...(c.minimumNoticeMinutes !== undefined && {
          minimumNoticeMinutes: c.minimumNoticeMinutes,
        }),
        ...(c.maximumMeetingsPerDay !== undefined && {
          maximumMeetingsPerDay: c.maximumMeetingsPerDay,
        }),
        ...(c.weekendEnabled !== undefined && { weekendEnabled: c.weekendEnabled }),
        ...(c.videoDefault !== undefined && { videoDefault: c.videoDefault }),
        ...(c.workingHours !== undefined && { workingHoursJson: c.workingHours }),
        ...(c.followUpDelaysHours !== undefined && {
          followUpDelaysJson: c.followUpDelaysHours,
        }),
        ...(c.quietHours !== undefined && { quietHoursJson: c.quietHours }),
      };
      await db.calendarPreference.upsert({
        where: { userId: user.id },
        update: calendarData,
        create: { userId: user.id, timezone: data.timezone ?? user.timezone, ...calendarData },
      });
    }

    if (data.style) {
      const s = data.style;
      const styleData = {
        ...(s.mode !== undefined && { mode: s.mode }),
        ...(s.formality !== undefined && { formality: s.formality }),
        ...(s.emojiEnabled !== undefined && { emojiEnabled: s.emojiEnabled }),
        ...(s.customInstructions !== undefined && {
          customInstructions: s.customInstructions,
        }),
      };
      await db.stylePreference.upsert({
        where: { userId: user.id },
        update: styleData,
        create: { userId: user.id, ...styleData },
      });
    }

    const result = await loadPreferences();
    return NextResponse.json(result);
  } catch {
    return serverError("preferences update failed");
  }
}
