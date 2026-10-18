import { describe, expect, it } from "vitest";
import * as api from "../../../api/src/auth/permissions";
import { ROLES, can, type Operation } from "./permissions";

// 網羅リストは ROLE_PERMISSIONS から導かない(表から操作が抜けると検査対象からも消えるため)。
// Operation に操作が増えたら下の「操作の集合」テストで tsc が落ちる。
const OPERATIONS = [
  "type:manage",
  "record:write",
  "record:delete",
  "record:read",
  "record:publish",
  "projection:rebuild",
  "module:manage",
  "site:manage",
  "member:manage",
] as const satisfies readonly Operation[];

describe("permissions", () => {
  it("ロールの集合は api の permissions.ts と一致する", () => {
    expect([...ROLES]).toEqual([...api.ROLES]);
  });

  it("全ロール × 全操作の判定が api の can と一致する", () => {
    for (const role of ROLES) {
      for (const operation of OPERATIONS) {
        expect(can(role, operation), `${role} ${operation}`).toBe(api.can(role, operation));
      }
    }
  });

  it("操作の集合は api の Operation 型と一致する(不一致は型検査で落ちる)", () => {
    type Same = [api.Operation] extends [Operation]
      ? [Operation] extends [api.Operation]
        ? true
        : false
      : false;
    const same: Same = true;
    expect(same).toBe(true);
    type Missing = Exclude<Operation, (typeof OPERATIONS)[number]>;
    const covered: [Missing] extends [never] ? true : false = true;
    expect(covered).toBe(true);
  });

  it("viewer は閲覧だけ、editor は公開まで、owner は型とモジュールも管理できる", () => {
    expect(can("viewer", "record:read")).toBe(true);
    expect(can("viewer", "record:write")).toBe(false);
    expect(can("viewer", "record:publish")).toBe(false);
    expect(can("editor", "record:publish")).toBe(true);
    expect(can("editor", "type:manage")).toBe(false);
    expect(can("owner", "module:manage")).toBe(true);
  });

  it("未知のロールには何も許可しない", () => {
    expect(can("auditor", "record:read")).toBe(false);
    expect(can("", "record:read")).toBe(false);
  });
});
