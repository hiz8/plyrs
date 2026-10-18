import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import { ROLES as API_ROLES } from "../../../api/src/auth/permissions";
import { ROLES, WORKFLOW_STATUS_LABELS, roleLabel } from "./labels";

describe("labels", () => {
  it("ワークフローの全ステータスに表示名がある", () => {
    for (const status of WORKFLOW_STATUSES) {
      expect(WORKFLOW_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("ロールの集合は api の permissions.ts と一致する", () => {
    expect([...ROLES]).toEqual([...API_ROLES]);
  });

  it("owner は「管理者」と表示し、未知のロールは値をそのまま出す", () => {
    expect(roleLabel("owner")).toBe("管理者");
    expect(roleLabel("editor")).toBe("編集者");
    expect(roleLabel("viewer")).toBe("閲覧者");
    expect(roleLabel("auditor")).toBe("auditor");
  });
});
