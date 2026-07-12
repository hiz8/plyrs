import { env } from "cloudflare:workers";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { blockUser, isBlocked, unblockUser } from "../src/auth/blocklist";
import { signTenantToken, TOKEN_TTL, verifyTenantToken } from "../src/auth/jwt";

const CLAIMS = {
  userId: "018f2b6a-7a0a-7000-8000-000000000001",
  tenantId: "018f2b6a-7a0a-7000-8000-000000000002",
  role: "editor",
} as const;

describe("tenant JWT (HS256, 15min)", () => {
  it("round-trips claims", async () => {
    const token = await signTenantToken(env.JWT_SECRET, CLAIMS);
    expect(TOKEN_TTL).toBe(900);
    expect(await verifyTenantToken(env.JWT_SECRET, token)).toEqual(CLAIMS);
  });

  it("rejects a wrong secret and a tampered token", async () => {
    const token = await signTenantToken(env.JWT_SECRET, CLAIMS);
    expect(await verifyTenantToken("other-secret", token)).toBeNull();
    expect(await verifyTenantToken(env.JWT_SECRET, `${token}x`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ tid: CLAIMS.tenantId, role: CLAIMS.role })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, expired)).toBeNull();
  });

  it("rejects structurally valid JWTs with missing or bogus claims", async () => {
    const missingTid = await new SignJWT({ role: "editor" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, missingTid)).toBeNull();

    const bogusRole = await new SignJWT({ tid: CLAIMS.tenantId, role: "superuser" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(CLAIMS.userId)
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    expect(await verifyTenantToken(env.JWT_SECRET, bogusRole)).toBeNull();
  });
});

describe("blocklist (KV)", () => {
  it("blocks and unblocks a user", async () => {
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(false);
    await blockUser(env.BLOCKLIST, "user-b");
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(true);
    await unblockUser(env.BLOCKLIST, "user-b");
    expect(await isBlocked(env.BLOCKLIST, "user-b")).toBe(false);
  });
});
