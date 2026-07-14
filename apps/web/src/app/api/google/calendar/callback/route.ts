import { NextResponse } from "next/server";
import { getDb, isDatabaseConfigured } from "@soon/database";
import {
  calendarOAuthClient,
  calendarOAuthConfigured,
  saveGoogleConnection,
} from "@/lib/google";

export const dynamic = "force-dynamic";

/** token exchange for the calendar-authorization flow */
export async function GET(request: Request) {
  if (!calendarOAuthConfigured()) {
    return NextResponse.json(
      { error: "google calendar oauth is not configured" },
      { status: 503 },
    );
  }
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = request.headers
    .get("cookie")
    ?.match(/soon_calendar_oauth_state=([^;]+)/)?.[1];
  if (!code) {
    return NextResponse.json({ error: "missing authorization code" }, { status: 400 });
  }
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.json({ error: "state mismatch" }, { status: 400 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }
  try {
    const client = calendarOAuthClient(url.origin);
    const { tokens } = await client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      return NextResponse.json(
        { error: "google did not return offline tokens — retry with consent" },
        { status: 400 },
      );
    }
    // TODO(integration): resolve the authenticated user from the session.
    // v0 control plane: single-tenant — attach to the first user.
    const db = getDb();
    const user = await db.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (!user) {
      return NextResponse.json({ error: "no user to attach connection to" }, { status: 409 });
    }
    await saveGoogleConnection({
      userId: user.id,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: tokens.scope?.split(" ") ?? [],
    });
    return NextResponse.redirect(`${url.origin}/preferences?connected=google`);
  } catch {
    return NextResponse.json({ error: "token exchange failed" }, { status: 502 });
  }
}
