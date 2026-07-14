/**
 * AvailabilityService port over @soon/calendar.
 *
 * per-user calendar access is resolved behind an injectable seam
 * (`resolveContext`) so the availability logic is testable with a
 * FakeCalendarApi; the default resolver loads the user's GoogleConnection,
 * decrypts the refresh token (@soon/security), builds an authenticated client,
 * and reads the blocking/destination calendars from calendar_preferences.
 */
import {
  createEvent as createCalendarEvent,
  createGoogleCalendarApi,
  getBusyIntervalsFromEvents,
  GoogleCalendarAuth,
  type CalendarApi,
} from "@soon/calendar";
import { getDb } from "@soon/database";
import { decryptSecret, deriveKeyFromMasterKey, type KeyRing } from "@soon/security";

import type { AvailabilityService } from "../ports.js";

/** the authenticated calendar api + the user's blocking/destination prefs. */
export interface CalendarContext {
  api: CalendarApi;
  blockingCalendarIds: string[];
  destinationCalendarId: string;
  tentativeBlocks: boolean;
}

export interface CalendarAvailabilityDeps {
  resolveContext: (userId: string) => Promise<CalendarContext>;
}

/** two intervals overlap when each starts before the other ends. */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start;
}

export function createCalendarAvailability(deps: CalendarAvailabilityDeps): AvailabilityService {
  return {
    async getBusy(userId, timeMinIso, timeMaxIso) {
      const ctx = await deps.resolveContext(userId);
      if (ctx.blockingCalendarIds.length === 0) return [];
      return getBusyIntervalsFromEvents(ctx.api, {
        calendarIds: ctx.blockingCalendarIds,
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        tentativeBlocks: ctx.tentativeBlocks,
      });
    },

    async slotStillFree(userId, slot) {
      const ctx = await deps.resolveContext(userId);
      if (ctx.blockingCalendarIds.length === 0) return true;
      const busy = await getBusyIntervalsFromEvents(ctx.api, {
        calendarIds: ctx.blockingCalendarIds,
        timeMin: new Date(slot.start).toISOString(),
        timeMax: new Date(slot.end).toISOString(),
        tentativeBlocks: ctx.tentativeBlocks,
      });
      return !busy.some((interval) => overlaps(interval, slot));
    },

    async createEvent(input) {
      const ctx = await deps.resolveContext(input.userId);
      const result = await createCalendarEvent(ctx.api, {
        calendarId: ctx.destinationCalendarId,
        startIso: input.startIso,
        endIso: input.endIso,
        timezone: input.timezone,
        attendeeEmail: input.attendeeEmail,
        title: input.title,
        ...(input.location !== undefined ? { location: input.location } : {}),
        wantsMeet: input.wantsMeet,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        idempotencyKey: input.idempotencyKey,
      });
      return {
        eventId: result.event.eventId,
        ...(result.event.htmlLink !== undefined ? { htmlLink: result.event.htmlLink } : {}),
      };
    },
  };
}

export interface DbCalendarResolverConfig {
  /** GOOGLE_CALENDAR_CLIENT_ID */
  clientId: string;
  /** GOOGLE_CALENDAR_CLIENT_SECRET */
  clientSecret: string;
  /** TOKEN_ENCRYPTION_KEY (base64) */
  tokenMasterKeyB64: string;
  /** DATA_ENCRYPTION_KEY_VERSION */
  keyVersion: number;
}

/**
 * default per-user resolver: GoogleConnection → decrypt refresh token →
 * authenticated client → calendar api, plus prefs from calendar_preferences.
 */
export function createDbCalendarContextResolver(
  config: DbCalendarResolverConfig,
): (userId: string) => Promise<CalendarContext> {
  const key = deriveKeyFromMasterKey(config.tokenMasterKeyB64);
  const ring: KeyRing = { [config.keyVersion]: key };
  const auth = new GoogleCalendarAuth({ clientId: config.clientId, clientSecret: config.clientSecret });

  return async (userId) => {
    const db = getDb();
    const conn = await db.googleConnection.findUnique({ where: { userId } });
    if (conn === null) throw new Error(`no google connection for user ${userId}`);

    const refreshToken = decryptSecret(conn.encryptedRefreshToken, ring);
    const client = auth.createClient({
      refreshToken,
      accessToken: decryptSecret(conn.encryptedAccessToken, ring),
      ...(conn.accessTokenExpiresAt !== null
        ? { accessTokenExpiresAt: conn.accessTokenExpiresAt.getTime() }
        : {}),
    });
    const api = createGoogleCalendarApi(client);

    const prefs = await db.calendarPreference.findUnique({ where: { userId } });
    return {
      api,
      blockingCalendarIds: prefs?.blockingCalendarIds ?? [],
      destinationCalendarId: prefs?.destinationCalendarId ?? "primary",
      tentativeBlocks: prefs?.tentativeBlocks ?? true,
    };
  };
}
