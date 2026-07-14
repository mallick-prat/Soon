import { NextResponse } from "next/server";
import { buildCalendarAuthUrl, calendarOAuthConfigured } from "@/lib/google";

export const dynamic = "force-dynamic";

/**
 * starts the separate calendar-authorization flow (offline access, minimal
 * calendar scopes). redirects the browser to google's consent screen.
 */
export function GET(request: Request) {
  if (!calendarOAuthConfigured()) {
    return NextResponse.json(
      { error: "google calendar oauth is not configured" },
      { status: 503 },
    );
  }
  const origin = new URL(request.url).origin;
  // TODO(integration): sign the state with @soon/security and bind it to the
  // authenticated user's session.
  const state = crypto.randomUUID();
  const url = buildCalendarAuthUrl(origin, state);
  const response = NextResponse.redirect(url);
  response.cookies.set("soon_calendar_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/google/calendar",
  });
  return response;
}
