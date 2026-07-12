import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createSession, lookupSession, revokeSession } from "../src/auth/session";

const NOW = new Date("2026-07-13T00:00:00Z");
const DAY = 86_400_000;

describe("sessions (D1-backed)", () => {
  it("creates a session and looks it up by opaque token", async () => {
    const { token, expiresAt } = await createSession(env.DB, "user-1", NOW);
    expect(token.length).toBeGreaterThanOrEqual(43); // 32byte base64url
    expect(expiresAt).toBe(new Date(NOW.getTime() + 30 * DAY).toISOString());
    expect(await lookupSession(env.DB, token, NOW)).toEqual({ userId: "user-1" });
  });

  it("stores only a hash of the token (raw token absent from D1)", async () => {
    const { token } = await createSession(env.DB, "user-2", NOW);
    const { results } = await env.DB.prepare("SELECT token_hash FROM sessions").all<{
      token_hash: string;
    }>();
    expect(results.some((row) => row.token_hash === token)).toBe(false);
    expect(results.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true);
  });

  it("returns null for unknown, expired, and revoked tokens", async () => {
    expect(await lookupSession(env.DB, "no-such-token", NOW)).toBeNull();

    const { token: expired } = await createSession(env.DB, "user-3", NOW);
    expect(await lookupSession(env.DB, expired, new Date(NOW.getTime() + 31 * DAY))).toBeNull();

    const { token: revoked } = await createSession(env.DB, "user-4", NOW);
    await revokeSession(env.DB, revoked, NOW);
    expect(await lookupSession(env.DB, revoked, NOW)).toBeNull();
  });
});
