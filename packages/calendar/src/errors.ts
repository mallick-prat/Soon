/** the google oauth grant is revoked or expired. callers should pause scheduling and re-run onboarding. */
export class TokenRefreshError extends Error {
  override readonly name = "TokenRefreshError";
  readonly reason: "grant_revoked" | "no_access_token";

  constructor(
    message: string,
    reason: "grant_revoked" | "no_access_token",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.reason = reason;
  }
}

/** thrown when a mutation targets an event that soon did not create (or was not explicitly linked to). */
export class NotSoonEventError extends Error {
  override readonly name = "NotSoonEventError";
  readonly calendarId: string;
  readonly eventId: string;

  constructor(calendarId: string, eventId: string) {
    super(`event ${eventId} on calendar ${calendarId} was not created by soon; refusing to modify it`);
    this.calendarId = calendarId;
    this.eventId = eventId;
  }
}

/**
 * a free/busy query failed for one of the requested calendars. treated as fatal —
 * silently assuming "free" for an unreadable calendar would risk double-booking.
 */
export class FreeBusyLookupError extends Error {
  override readonly name = "FreeBusyLookupError";
  readonly calendarId: string;

  constructor(calendarId: string, reason?: string) {
    super(
      `free/busy lookup failed for calendar ${calendarId}${reason === undefined ? "" : `: ${reason}`}`,
    );
    this.calendarId = calendarId;
  }
}
