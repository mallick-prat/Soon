import { NextResponse } from "next/server";
import { mintEnrollmentToken } from "@soon/security";

import { deviceSigningSecret } from "@/lib/devices";
import { getSessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

const ENROLLMENT_TTL_SECONDS = 10 * 60;

/**
 * dashboard-only: the signed-in user mints a short-lived enrollment token,
 * which they enter in the mac app to pair it. never usable as a gateway token
 * (distinct audience).
 */
export async function POST() {
  const userId = await getSessionUserId();
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const enrollmentToken = await mintEnrollmentToken({
    userId,
    secret: deviceSigningSecret(),
    expiresInSeconds: ENROLLMENT_TTL_SECONDS,
  });
  return NextResponse.json({ enrollmentToken, expiresInSeconds: ENROLLMENT_TTL_SECONDS });
}
