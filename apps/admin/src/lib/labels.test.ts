import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import { ROLE_LABELS, WORKFLOW_STATUS_LABELS, roleLabel } from "./labels";
import { ROLES } from "./permissions";

describe("labels", () => {
  it("ワークフローの全ステータスに表示名がある", () => {
    for (const status of WORKFLOW_STATUSES) {
      expect(WORKFLOW_STATUS_LABELS[status]).toBeTruthy();
    }
  });

  it("全ロールに表示名がある", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("owner は「管理者」と表示し、未知のロールは値をそのまま出す", () => {
    expect(roleLabel("owner")).toBe("管理者");
    expect(roleLabel("editor")).toBe("編集者");
    expect(roleLabel("viewer")).toBe("閲覧者");
    expect(roleLabel("auditor")).toBe("auditor");
  });
});
