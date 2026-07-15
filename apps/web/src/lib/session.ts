import { getDb, isDatabaseConfigured } from "@soon/database";

import { auth } from "@/auth";

/**
 * resolve the signed-in user's id from the next-auth session, or null when
 * unauthenticated / no matching user / db unavailable.
 */
export async function getSessionUserId(): Promise<string | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email || !isDatabaseConfigured()) return null;
  const user = await getDb().user.findFirst({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * user id to attach an enrolling device to: requires a signed-in session, but
 * in this single-user (jwt-session, no db adapter) phase the session email may
 * not have its own row — fall back to the primary user so the device attaches
 * to the same account the rest of the data lives under.
 */
export async function getEnrollingUserId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.email || !isDatabaseConfigured()) return null;
  const db = getDb();
  const byEmail = await db.user.findFirst({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (byEmail !== null) return byEmail.id;
  const primary = await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return primary?.id ?? null;
}
