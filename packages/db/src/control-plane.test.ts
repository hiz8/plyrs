import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditLogs,
  deadLetters,
  memberships,
  sessions,
  superAdmins,
  superSessions,
  tenants,
  users,
} from "./control-plane";

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
    // Verify actual DB column names via introspection of column objects
    // Each column object has a _ property with name = the actual SQL column name
    const superAdminsColumnNames = Object.values(superAdmins)
      .map((col) => col?._?.name || col?.name)
      .filter(Boolean);
    expect(superAdminsColumnNames).toEqual(
      expect.arrayContaining([
        "id",
        "email",
        "password_hash",
        "totp_secret",
        "totp_last_counter",
        "created_at",
      ]),
    );
  });

  it("defines audit_logs and dead_letters", () => {
    expect(getTableName(auditLogs)).toBe("audit_logs");
    expect(getTableName(deadLetters)).toBe("dead_letters");
    // Verify actual DB column names
    const auditLogsColumnNames = Object.values(auditLogs)
      .map((col) => col?._?.name || col?.name)
      .filter(Boolean);
    expect(auditLogsColumnNames).toEqual(
      expect.arrayContaining([
        "id",
        "actor_id",
        "action",
        "target_type",
        "target_id",
        "detail",
        "created_at",
      ]),
    );
    const deadLettersColumnNames = Object.values(deadLetters)
      .map((col) => col?._?.name || col?.name)
      .filter(Boolean);
    expect(deadLettersColumnNames).toEqual(
      expect.arrayContaining(["id", "queue", "body", "failed_at", "replayed_at"]),
    );
  });
});
