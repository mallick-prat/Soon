import { describe, expect, it } from "vitest";
import { isGrantRevokedError, refreshAccessToken } from "./auth.js";
import type { TokenRefreshClient } from "./auth.js";
import { TokenRefreshError } from "./errors.js";

function clientReturning(credentials: {
  access_token?: string | null;
  expiry_date?: number | null;
}): TokenRefreshClient {
  return { refreshAccessToken: async () => ({ credentials }) };
}

function clientThrowing(err: unknown): TokenRefreshClient {
  return {
    refreshAccessToken: async () => {
      throw err;
    },
  };
}

describe("refreshAccessToken", () => {
  it("returns the refreshed access token and expiry", async () => {
    const result = await refreshAccessToken(
      clientReturning({ access_token: "ya29.fresh", expiry_date: 1_752_500_000_000 }),
    );
    expect(result).toEqual({ accessToken: "ya29.fresh", expiresAt: 1_752_500_000_000 });
  });

  it("omits expiresAt when google does not return an expiry", async () => {
    const result = await refreshAccessToken(clientReturning({ access_token: "ya29.fresh" }));
    expect(result).toEqual({ accessToken: "ya29.fresh" });
  });

  it("maps invalid_grant in the response body to TokenRefreshError", async () => {
    const gaxiosLike = Object.assign(new Error("request failed with status code 400"), {
      response: { data: { error: "invalid_grant", error_description: "Token has been revoked." } },
    });
    const promise = refreshAccessToken(clientThrowing(gaxiosLike));
    await expect(promise).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(promise).rejects.toMatchObject({ reason: "grant_revoked" });
  });

  it("maps invalid_grant in the error message to TokenRefreshError", async () => {
    const promise = refreshAccessToken(clientThrowing(new Error("invalid_grant")));
    await expect(promise).rejects.toBeInstanceOf(TokenRefreshError);
  });

  it("rethrows unrelated errors untouched so retry policy can handle them", async () => {
    const network = new Error("socket hang up");
    await expect(refreshAccessToken(clientThrowing(network))).rejects.toBe(network);
  });

  it("throws TokenRefreshError when the response carries no access token", async () => {
    const promise = refreshAccessToken(clientReturning({ access_token: null }));
    await expect(promise).rejects.toBeInstanceOf(TokenRefreshError);
    await expect(promise).rejects.toMatchObject({ reason: "no_access_token" });
  });
});

describe("isGrantRevokedError", () => {
  it("rejects non-object and unrelated errors", () => {
    expect(isGrantRevokedError("invalid_grant")).toBe(false);
    expect(isGrantRevokedError(new Error("rate limit exceeded"))).toBe(false);
    expect(isGrantRevokedError(null)).toBe(false);
  });
});
