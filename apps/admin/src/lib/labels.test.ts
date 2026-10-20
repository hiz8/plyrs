import { WORKFLOW_STATUSES } from "@plyrs/metamodel";
import { describe, expect, it } from "vitest";
import { LIST_TABS } from "./content-list";
import { BULK_LABELS, LIST_LABELS, ROLE_LABELS, WORKFLOW_STATUS_LABELS, roleLabel } from "./labels";
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

  it("一覧のタブ文言が LIST_TABS を網羅する", () => {
    expect(Object.keys(LIST_LABELS.tabs).sort()).toEqual([...LIST_TABS].sort());
  });

  it("一括操作の文言は 4 種の操作で揃っている", () => {
    const keys = Object.keys(BULK_LABELS.actions).sort();
    expect(Object.keys(BULK_LABELS.running).sort()).toEqual(keys);
    expect(Object.keys(BULK_LABELS.retry).sort()).toEqual(keys);
    expect(Object.keys(BULK_LABELS.done).sort()).toEqual(keys);
    expect(Object.keys(BULK_LABELS.failed).sort()).toEqual(keys);
  });
});
