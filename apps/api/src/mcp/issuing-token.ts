import { isRole, type Role } from "../auth/permissions";
import { hasGrant } from "../oauth/grants";

// design-spec 16.11(M5a-4): アップロードの受け取りで、発行に使ったトークンが今も有効かと今のロールを
// 引き直す。発行から受け取りまで(最長 10 分)の間の PAT の失効・期限切れ、OAuth の付与の失効、ロールの
// 降格、会員からの除外を拾う(BAN と会員解除の BLOCKLIST だけでは降格と失効を見られない)。

export interface UploadIssuer {
  userId: string;
  tokenId: string;
  tokenKind: "pat" | "oauth";
}

// 発行に使ったトークンが今も有効なら、今の memberships のロールを返す。無効・会員でなければ null
export async function currentRoleOfIssuer(
  env: Env,
  tenantId: string,
  issuer: UploadIssuer,
  now: Date,
): Promise<Role | null> {
  let row: { role: string } | null;
  if (issuer.tokenKind === "pat") {
    // verifyPat と同じ条件を、ハッシュではなく行 ID で引く(D1 の 1 照会)
    row = await env.DB.prepare(
      `SELECT m.role
         FROM personal_access_tokens p
         JOIN memberships m ON m.user_id = p.user_id AND m.tenant_id = p.tenant_id
        WHERE p.id = ? AND p.tenant_id = ? AND p.user_id = ? AND p.revoked_at IS NULL AND p.expires_at > ?`,
    )
      .bind(issuer.tokenId, tenantId, issuer.userId, now.toISOString())
      .first<{ role: string }>();
  } else {
    // OAuth は付与が残っていること(KV の 1 回の get)と会員であること(D1 の 1 照会)。入口が token から
    // grantId を取り出せず tokenId に clientId を入れた場合は、その名前の付与が無いので null(安全側)
    if (!(await hasGrant(env, issuer.userId, issuer.tokenId))) {
      return null;
    }
    row = await env.DB.prepare("SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?")
      .bind(issuer.userId, tenantId)
      .first<{ role: string }>();
  }
  return row !== null && isRole(row.role) ? row.role : null;
}
