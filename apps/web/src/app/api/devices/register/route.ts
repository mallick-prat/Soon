import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@soon/database";
import { verifyEnrollmentToken } from "@soon/security";

import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";
import { DEVICE_TOKEN_TTL_SECONDS, deviceSigningSecret, mintDeviceAccessToken } from "@/lib/devices";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  /** short-lived token minted by the dashboard for the signed-in user */
  enrollmentToken: z.string(),
  /** ed25519 spki pem — trusted on first use, used later for token refresh */
  devicePublicKey: z.string().min(32),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(40).optional(),
});

/**
 * pair a mac: exchange a dashboard enrollment token for an activated device
 * row and a gateway access token. the returned token's deviceId claim equals
 * the mac_devices row id — what the gateway routes commands on.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { data, error } = await parseBody(request, registerSchema);
  if (error) return error;

  let userId: string;
  try {
    ({ userId } = await verifyEnrollmentToken(data.enrollmentToken, { secret: deviceSigningSecret() }));
  } catch {
    return NextResponse.json({ error: "invalid_enrollment_token" }, { status: 401 });
  }

  try {
    const db = getDb();
    const device = await db.macDevice.upsert({
      where: { devicePublicKey: data.devicePublicKey },
      update: {
        userId,
        status: "active",
        lastSeenAt: new Date(),
        ...(data.deviceName !== undefined && { deviceName: data.deviceName }),
        ...(data.appVersion !== undefined && { appVersion: data.appVersion }),
      },
      create: {
        userId,
        devicePublicKey: data.devicePublicKey,
        status: "active",
        lastSeenAt: new Date(),
        ...(data.deviceName !== undefined && { deviceName: data.deviceName }),
        ...(data.appVersion !== undefined && { appVersion: data.appVersion }),
      },
    });
    const token = await mintDeviceAccessToken(device.id, userId);
    return NextResponse.json(
      {
        device: { id: device.id, status: device.status },
        token,
        expiresInSeconds: DEVICE_TOKEN_TTL_SECONDS,
      },
      { status: 201 },
    );
  } catch {
    return serverError("device registration failed");
  }
}
