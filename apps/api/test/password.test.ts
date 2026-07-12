import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing (PBKDF2)", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored.startsWith("pbkdf2-sha256$100000$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(await verifyPassword("Tr0ub4dor&3", stored)).toBe(false);
  });

  it("salts every hash (same password, different digests)", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("rejects malformed or tampered stored values without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$999999999$AAAA$BBBB")).toBe(false);
    const stored = await hashPassword("x");
    const tampered = `${stored.slice(0, -4)}AAAA`;
    expect(await verifyPassword("x", tampered)).toBe(false);
  });
});
