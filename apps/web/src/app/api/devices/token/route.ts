import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@soon/database";
import { deviceProofMessage, verifyDeviceProof } from "@soon/security";

import { parseBody, requireDatabase, serverError } from "@/lib/api-helpers";
import { DEVICE_TOKEN_TTL_SECONDS, mintDeviceAccessToken } from "@/lib/devices";

export const dynamic = "force-dynamic";

/** how far a proof's issuedAt may drift from server time */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const tokenSchema = z.object({
  deviceId: z.string(),
  issuedAtMs: z.number().int().positive(),
  /** base64 ed25519 signature over deviceProofMessage(deviceId, issuedAtMs) */
  signature: z.string(),
});

/**
 * refresh a gateway access token. the mac proves control of its device key by
 * signing a fresh challenge; no dashboard session is required. this is how the
 * headless companion re-authenticates before its token expires.
 */
export async function POST(request: Request) {
  const unavailable = requireDatabase();
  if (unavailable) return unavailable;
  const { data, error } = await parseBody(request, tokenSchema);
  if (error) return error;

  try {
    const db = getDb();
    const device = await db.macDevice.findUnique({ where: { id: data.deviceId } });
    if (device === null || device.status === "revoked" || device.status === "pending") {
      return NextResponse.json({ error: "unknown_or_inactive_device" }, { status: 401 });
    }
    if (Math.abs(Date.now() - data.issuedAtMs) > CLOCK_SKEW_MS) {
      return NextResponse.json({ error: "stale_proof" }, { status: 401 });
    }
    const message = deviceProofMessage(device.id, data.issuedAtMs);
    if (!verifyDeviceProof(device.devicePublicKey, message, data.signature)) {
      return NextResponse.json({ error: "invalid_proof" }, { status: 401 });
    }
    const token = await mintDeviceAccessToken(device.id, device.userId);
    await db.macDevice.update({
      where: { id: device.id },
      data: { lastSeenAt: new Date(), status: "active" },
    });
    return NextResponse.json({ token, expiresInSeconds: DEVICE_TOKEN_TTL_SECONDS });
  } catch {
    return serverError("token issuance failed");
  }
}
