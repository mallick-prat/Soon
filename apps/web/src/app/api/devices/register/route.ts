import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@soon/database";
import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  devicePublicKey: z.string().min(32),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

/**
 * mac device registration stub.
 * TODO(integration): @soon/security should verify a signed enrollment
 * challenge before the device is marked active; the realtime gateway then
 * takes over the heartbeat.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { data, error } = await parseBody(request, registerSchema);
  if (error) return error;
  try {
    const db = getDb();
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) return NextResponse.json({ error: "no user" }, { status: 409 });
    const device = await db.macDevice.upsert({
      where: { devicePublicKey: data.devicePublicKey },
      update: {
        lastSeenAt: new Date(),
        ...(data.deviceName !== undefined && { deviceName: data.deviceName }),
        ...(data.appVersion !== undefined && { appVersion: data.appVersion }),
      },
      create: {
        userId: user.id,
        devicePublicKey: data.devicePublicKey,
        status: "pending",
        lastSeenAt: new Date(),
        ...(data.deviceName !== undefined && { deviceName: data.deviceName }),
        ...(data.appVersion !== undefined && { appVersion: data.appVersion }),
      },
    });
    return NextResponse.json({ device }, { status: 201 });
  } catch {
    return serverError("device registration failed");
  }
}
