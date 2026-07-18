import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLogs, deadLetters, memberships, sessions, superAdmins, superSessions, tenants, users } from "./control-plane";

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

  it("defines super admin tables separated from users", () => {
    expect(getTableName(superAdmins)).toBe("super_admins");
    expect(getTableName(superSessions)).toBe("super_sessions");
    const columns = Object.keys(superAdmins);
    expect(columns).toEqual(
      expect.arrayContaining(["id", "email", "passwordHash", "totpSecret", "totpLastCounter", "createdAt"]),
    );
  });

  it("defines audit_logs and dead_letters", () => {
    expect(Object.keys(auditLogs)).toEqual(
      expect.arrayContaining(["id", "actorId", "action", "targetType", "targetId", "detail", "createdAt"]),
    );
    expect(Object.keys(deadLetters)).toEqual(
      expect.arrayContaining(["id", "queue", "body", "failedAt", "replayedAt"]),
    );
  });
});
