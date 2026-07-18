import { describe, expect, it } from "vitest";
import {
  base32Decode,
  generateTotpCode,
  generateTotpSecret,
  otpauthUri,
  verifyTotpCode,
} from "./totp";

const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totp", () => {
  it("matches RFC 6238 SHA-1 test vectors (6 digits)", async () => {
    expect(await generateTotpCode(RFC_SECRET, 59_000)).toBe("287082"); // T=59 → 94287082
    expect(await generateTotpCode(RFC_SECRET, 1_111_111_109_000)).toBe("081804"); // → 07081804
    expect(await generateTotpCode(RFC_SECRET, 1_111_111_111_000)).toBe("050471"); // → 14050471
  });

  it("verifies with ±1 step drift and returns the matched counter", async () => {
    const code = await generateTotpCode(RFC_SECRET, 59_000); // counter 1
    expect(await verifyTotpCode(RFC_SECRET, code, 59_000)).toBe(1);
    expect(await verifyTotpCode(RFC_SECRET, code, 89_000)).toBe(1); // drift -1
    expect(await verifyTotpCode(RFC_SECRET, code, 29_000)).toBe(1); // drift +1
    expect(await verifyTotpCode(RFC_SECRET, code, 149_000)).toBeNull(); // 2 step 先は拒否
  });

  it("rejects malformed codes and secrets", async () => {
    expect(await verifyTotpCode(RFC_SECRET, "12345", 59_000)).toBeNull();
    expect(await verifyTotpCode(RFC_SECRET, "abcdef", 59_000)).toBeNull();
    expect(await verifyTotpCode("!!invalid!!", "287082", 59_000)).toBeNull();
  });

  it("generates a 32-char base32 secret that roundtrips", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("builds an otpauth URI with issuer and encoded label", () => {
    expect(otpauthUri("a@b.com", RFC_SECRET)).toBe(
      `otpauth://totp/plyrs:a%40b.com?secret=${RFC_SECRET}&issuer=plyrs&algorithm=SHA1&digits=6&period=30`,
    );
  });
});
