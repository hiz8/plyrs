import type { Role } from "../auth/permissions";

// design-spec 16.11(M4-4、決定 51): MCP のアセット登録に使う使い切りのアップロードトークン。
// トークンの原文は Worker が作ってエージェントに返し、DO には SHA-256 だけを置く(DO の SQLite が漏れても
// アップロードを横取りできない)。テナント = DO なので、別テナントの URL に出したトークンはその DO に
// 行が無く not_found になる。使い切りは single-writer の DO で used_at を立てて保証する
// (KV は書き込みの直後の読みが一致しないので、二重使用を防げない)。

// 発行のついでに掃除する期限切れの行の上限(1 回の発行の書き込み量を抑える)
export const ASSET_UPLOAD_SWEEP_LIMIT = 50;

export interface AssetUploadRow {
  tokenHash: string;
  userId: string;
  role: Role;
  tokenId: string;
  filename: string;
  contentType: string;
  expiresAt: string;
}

export function createAssetUploadCore(sql: SqlStorage, row: AssetUploadRow, now: string): void {
  sql.exec(
    `DELETE FROM asset_upload_tokens WHERE token_hash IN (
       SELECT token_hash FROM asset_upload_tokens WHERE expires_at < ? LIMIT ?
     )`,
    now,
    ASSET_UPLOAD_SWEEP_LIMIT,
  );
  sql.exec(
    `INSERT INTO asset_upload_tokens
       (token_hash, user_id, role, token_id, filename, content_type, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    row.tokenHash,
    row.userId,
    row.role,
    row.tokenId,
    row.filename,
    row.contentType,
    row.expiresAt,
    now,
  );
}

export type ClaimAssetUploadResult =
  | {
      ok: true;
      userId: string;
      role: Role;
      tokenId: string;
      filename: string;
      contentType: string;
    }
  | { ok: false; code: "not_found" | "expired" | "used" };

// 受け取り。used_at を立ててから返す(R2 に書く前に使い切る。保存に失敗しても同じトークンは使えない —
// エージェントは asset_upload からやり直す)
export function claimAssetUploadCore(
  sql: SqlStorage,
  tokenHash: string,
  now: string,
): ClaimAssetUploadResult {
  const row = sql
    .exec<{
      user_id: string;
      role: Role;
      token_id: string;
      filename: string;
      content_type: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT user_id, role, token_id, filename, content_type, expires_at, used_at
         FROM asset_upload_tokens WHERE token_hash = ?`,
      tokenHash,
    )
    .toArray()[0];
  if (row === undefined) {
    return { ok: false, code: "not_found" };
  }
  if (row.used_at !== null) {
    return { ok: false, code: "used" };
  }
  if (row.expires_at <= now) {
    return { ok: false, code: "expired" };
  }
  sql.exec("UPDATE asset_upload_tokens SET used_at = ? WHERE token_hash = ?", now, tokenHash);
  return {
    ok: true,
    userId: row.user_id,
    role: row.role,
    tokenId: row.token_id,
    filename: row.filename,
    contentType: row.content_type,
  };
}
