import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memberships, sessions, tenants, users } from "./control-plane";

describe("@plyrs/db control plane schema", () => {
  it("defines the four control-plane tables (design-spec §2)", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(users)).toBe("users");
    expect(getTableName(memberships)).toBe("memberships");
    expect(getTableName(sessions)).toBe("sessions");
  });

  it("gives sessions the revocation and expiry columns (design-spec §11.2)", () => {
    expect(sessions.tokenHash).toBeDefined();
    expect(sessions.expiresAt).toBeDefined();
    expect(sessions.revokedAt).toBeDefined();
  });
});
