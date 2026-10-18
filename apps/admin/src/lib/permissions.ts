// 案 H 7 章: 画面の出し分けの判定はここに集約する。対応表は api の auth/permissions.ts と同じもの
// (api は管理画面の依存に無いため複製し、一致を permissions.test.ts で確かめる)。
// 画面の出し分けは誤操作を減らすためのもので、守りは API 側の判定が担う。
export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

// デフォルトロールの操作のみ。モジュールが宣言する権限(design-spec §11 の「モジュール ID で名前空間化」)を
// 画面で出し分けるときは、ロール直書きに戻さず `${moduleId}.${key}` を受ける形でここを拡張する。
export type Operation =
  | "type:manage"
  | "record:write"
  | "record:delete"
  | "record:read"
  | "record:publish"
  | "projection:rebuild"
  | "module:manage";

export const ROLE_PERMISSIONS: Record<Role, readonly Operation[]> = {
  owner: [
    "type:manage",
    "record:write",
    "record:delete",
    "record:read",
    "record:publish",
    "projection:rebuild",
    "module:manage",
  ],
  editor: ["record:write", "record:delete", "record:read", "record:publish"],
  viewer: ["record:read"],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// TenantSummary.role はサーバーから文字列で届く。未知のロールには何も許可しない。
export function can(role: string, operation: Operation): boolean {
  return isRole(role) && ROLE_PERMISSIONS[role].includes(operation);
}
