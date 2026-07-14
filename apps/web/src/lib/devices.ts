import { mintDeviceJwt } from "@soon/security";

/** device access tokens are long-lived; the mac refreshes before expiry. */
export const DEVICE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/** shared secret the realtime gateway verifies device jwts with (HS256). */
export function deviceSigningSecret(): string {
  const secret = process.env.DEVICE_JWT_SECRET;
  if (!secret) {
    throw new Error("DEVICE_JWT_SECRET is not set; cannot mint device access tokens");
  }
  return secret;
}

/**
 * mint the gateway access jwt. the deviceId claim MUST equal the mac_devices
 * row id — that's what the gateway routes commands on.
 */
export function mintDeviceAccessToken(deviceId: string, userId: string): Promise<string> {
  return mintDeviceJwt({
    deviceId,
    userId,
    secret: deviceSigningSecret(),
    expiresInSeconds: DEVICE_TOKEN_TTL_SECONDS,
  });
}
