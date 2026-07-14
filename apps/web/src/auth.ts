import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

/**
 * ordinary sign-in with google (identity only — calendar authorization is a
 * separate, minimal-scope flow under /api/google/calendar).
 *
 * everything is guarded so `next build` succeeds with no env vars: the
 * provider list is empty until AUTH_GOOGLE_ID/SECRET exist, and a dev-only
 * fallback secret keeps the handler constructible.
 */
const googleConfigured = Boolean(
  process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET,
);

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? "soon-dev-only-secret-not-for-production",
  trustHost: true,
  providers: googleConfigured
    ? [
        Google({
          clientId: process.env.AUTH_GOOGLE_ID,
          clientSecret: process.env.AUTH_GOOGLE_SECRET,
        }),
      ]
    : [],
  pages: {},
  callbacks: {
    session({ session }) {
      return session;
    },
  },
});
