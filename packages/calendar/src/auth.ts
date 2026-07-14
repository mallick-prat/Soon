import { OAuth2Client } from "google-auth-library";
import { TokenRefreshError } from "./errors.js";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string | undefined;
}

/**
 * tokens as handed to this layer — plain strings. they are encrypted at rest by the
 * security package; this package never sees or performs encryption.
 */
export interface StoredGoogleTokens {
  refreshToken: string;
  accessToken?: string | undefined;
  /** epoch ms */
  accessTokenExpiresAt?: number | undefined;
}

export interface RefreshedAccessToken {
  accessToken: string;
  /** epoch ms */
  expiresAt?: number | undefined;
}

/** the one slice of OAuth2Client that token refresh needs; fakes implement this in tests. */
export interface TokenRefreshClient {
  refreshAccessToken(): Promise<{
    credentials: { access_token?: string | null | undefined; expiry_date?: number | null | undefined };
  }>;
}

/**
 * google reports a revoked or expired refresh token as an "invalid_grant" oauth error.
 * gaxios surfaces it either in the response body or the error message depending on version.
 */
export function isGrantRevokedError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as {
    message?: unknown;
    response?: { data?: { error?: unknown } | undefined } | undefined;
  };
  if (candidate.response?.data?.error === "invalid_grant") return true;
  return typeof candidate.message === "string" && candidate.message.includes("invalid_grant");
}

/**
 * exchange a refresh token for a fresh access token. maps a revoked/expired grant to a
 * typed TokenRefreshError so callers can pause scheduling; other failures (network,
 * rate limits) are rethrown untouched so retry policy can handle them.
 */
export async function refreshAccessToken(client: TokenRefreshClient): Promise<RefreshedAccessToken> {
  let credentials: { access_token?: string | null | undefined; expiry_date?: number | null | undefined };
  try {
    ({ credentials } = await client.refreshAccessToken());
  } catch (err) {
    if (isGrantRevokedError(err)) {
      throw new TokenRefreshError(
        "google oauth grant is revoked or expired; pause scheduling and reconnect the calendar",
        "grant_revoked",
        { cause: err },
      );
    }
    throw err;
  }
  const accessToken = credentials.access_token;
  if (accessToken === undefined || accessToken === null || accessToken === "") {
    throw new TokenRefreshError("google returned no access token on refresh", "no_access_token");
  }
  const expiryDate = credentials.expiry_date;
  return {
    accessToken,
    ...(expiryDate !== undefined && expiryDate !== null ? { expiresAt: expiryDate } : {}),
  };
}

export class GoogleCalendarAuth {
  private readonly config: GoogleOAuthConfig;

  constructor(config: GoogleOAuthConfig) {
    this.config = config;
  }

  /** build an oauth2 client carrying the stored tokens, ready to pass to googleapis. */
  createClient(tokens: StoredGoogleTokens): OAuth2Client {
    const client = new OAuth2Client({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      ...(this.config.redirectUri !== undefined ? { redirectUri: this.config.redirectUri } : {}),
    });
    client.setCredentials({
      refresh_token: tokens.refreshToken,
      ...(tokens.accessToken !== undefined ? { access_token: tokens.accessToken } : {}),
      ...(tokens.accessTokenExpiresAt !== undefined
        ? { expiry_date: tokens.accessTokenExpiresAt }
        : {}),
    });
    return client;
  }

  /** refresh the access token now; throws TokenRefreshError when the grant is revoked/expired. */
  async refresh(tokens: StoredGoogleTokens): Promise<RefreshedAccessToken> {
    return refreshAccessToken(this.createClient(tokens));
  }
}
