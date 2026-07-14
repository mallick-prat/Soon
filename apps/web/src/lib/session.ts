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
