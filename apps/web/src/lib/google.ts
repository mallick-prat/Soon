import { google } from "googleapis";
import { getDb, isDatabaseConfigured } from "@soon/database";
import { tokenCipher } from "./integrations";

/**
 * the calendar-authorization flow is separate from sign-in and requests the
 * minimal scopes soon needs: read free/busy + calendar list, write events.
 */
export const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
];

export function calendarOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
  );
}

export function calendarOAuthClient(origin: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    `${origin}/api/google/calendar/callback`,
  );
}

/** builds the offline-access consent url */
export function buildCalendarAuthUrl(origin: string, state: string): string {
  return calendarOAuthClient(origin).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: CALENDAR_SCOPES,
    include_granted_scopes: false,
    state,
  });
}

/**
 * the connected account's email is the id of its primary calendar — available
 * with the calendarlist scope we already request (no email/profile scope).
 */
export async function fetchGoogleAccountEmail(
  client: ReturnType<typeof calendarOAuthClient>,
): Promise<string | undefined> {
  try {
    const cal = google.calendar({ version: "v3", auth: client });
    const primary = await cal.calendarList.get({ calendarId: "primary" });
    return primary.data.id ?? undefined;
  } catch {
    return undefined;
  }
}

export interface GoogleTokenPayload {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiryDate: Date | null;
  scopes: string[];
  googleAccountEmail?: string;
}

/**
 * persistence seam for the callback handler. tokens are passed through the
 * TokenCipher stub — TODO(integration): swap for @soon/security aes-gcm
 * envelope encryption before any real tokens are stored.
 */
export async function saveGoogleConnection(payload: GoogleTokenPayload): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error("database not configured");
  }
  const db = getDb();
  await db.googleConnection.upsert({
    where: { userId: payload.userId },
    update: {
      encryptedAccessToken: tokenCipher.encrypt(payload.accessToken),
      encryptedRefreshToken: tokenCipher.encrypt(payload.refreshToken),
      accessTokenExpiresAt: payload.expiryDate,
      scopes: payload.scopes,
      status: "connected",
      ...(payload.googleAccountEmail !== undefined && {
        googleAccountEmail: payload.googleAccountEmail,
      }),
    },
    create: {
      userId: payload.userId,
      encryptedAccessToken: tokenCipher.encrypt(payload.accessToken),
      encryptedRefreshToken: tokenCipher.encrypt(payload.refreshToken),
      accessTokenExpiresAt: payload.expiryDate,
      scopes: payload.scopes,
      status: "connected",
      ...(payload.googleAccountEmail !== undefined && {
        googleAccountEmail: payload.googleAccountEmail,
      }),
    },
  });
}
