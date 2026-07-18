export const ROLES = ["owner", "editor", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export type Operation =
  | "type:manage"
  | "record:write"
  | "record:delete"
  | "record:read"
  | "record:publish"
  | "projection:rebuild"
  | "module:manage";

// design-spec §11.5: デフォルトロールの権限展開表はコードに焼く（アプリと共にデプロイ）。
// モジュール宣言権限（Phase 9）は有効化時に DO の config へ書き込まれ、同じ判定面に加わる。
const ROLE_PERMISSIONS: Record<Role, readonly Operation[]> = {
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

export function can(role: Role, operation: Operation): boolean {
  return ROLE_PERMISSIONS[role].includes(operation);
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
