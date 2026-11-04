import { tenants } from "@plyrs/db/control-plane";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { isBlocked, isMembershipBlocked } from "../auth/blocklist";
import { sha256Hex } from "../auth/session";
import { MAX_ASSET_SIZE_BYTES, readCapped, storeAsset } from "../assets/store";
import { can } from "../auth/permissions";
import type { McpAuth } from "../do/authorize";
import { currentRoleOfIssuer } from "./issuing-token";
import { asClaimAssetUploadResult } from "../rpc-unwrap";

// design-spec 16.11(M4-4、決定 51): asset_upload が発行した URL への本文の受け取り。
// Authorization は見ない(URL のトークンが使い切りの資格)。入口の順序:
// Origin が付いていれば拒否(ブラウザからの直接 POST を想定しない)→ 接続元 IP の Rate Limiting →
// トークンの形 → Content-Length の前検査(413)→ D1 でテナントの存在(404)→ DO で使い切りの印を立てる(無い 404、期限切れ・使用済み 410)
// → BLOCKLIST の 2 キー(発行後に BAN された利用者は 403)→ 発行に使ったトークンの有効性と今のロール
// (失効・期限切れ・会員でなければ 403 token_revoked、record:write の無いロールなら 403 forbidden。M5a-4)
// → 本文を上限付きで読む → storeAsset → 201。403 はどれも本文を読む前に返すので R2 に何も書かない。
// 使い切りの印は先に立つので、403 になったトークンも再利用できない

const RETRY_AFTER_SECONDS = "60";
// generateSessionToken の形(32 バイトの base64url = 43 文字)
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const uploadRoutes = new Hono<{ Bindings: Env }>().all(
  "/t/:tenantId/uploads/:token",
  async (c) => {
    if (c.req.method !== "POST") {
      return c.json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    }
    if (c.req.header("origin") !== undefined) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    const ipLimiter = c.env.MCP_IP_LIMITER;
    if (ipLimiter === undefined) {
      return c.json({ error: "not_configured", what: "MCP_IP_LIMITER" }, 503);
    }
    const { success } = await ipLimiter.limit({
      key: c.req.header("cf-connecting-ip") ?? "unknown",
    });
    if (!success) {
      return c.json({ error: "rate_limited" }, 429, { "retry-after": RETRY_AFTER_SECONDS });
    }
    const token = c.req.param("token");
    if (!TOKEN_PATTERN.test(token)) {
      return c.json({ error: "not_found" }, 404);
    }
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_ASSET_SIZE_BYTES) {
      return c.json({ error: "too_large" }, 413);
    }
    const tenantId = c.req.param("tenantId");
    // 未認証の入口なので、D1 にあるテナントだけ DO を起こす(任意の tenantId で DO を作らせない。
    // DO は起こすだけで migrations を走らせ、ストレージを残す)
    const tenant = (
      await drizzle(c.env.DB)
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1)
    )[0];
    if (tenant === undefined) {
      return c.json({ error: "not_found" }, 404);
    }
    const stub = c.env.TENANT_DO.get(c.env.TENANT_DO.idFromName(tenantId));
    const claimed = asClaimAssetUploadResult(await stub.claimAssetUpload(await sha256Hex(token)));
    if (!claimed.ok) {
      return claimed.code === "not_found"
        ? c.json({ error: "not_found" }, 404)
        : c.json({ error: claimed.code }, 410);
    }
    if (
      (await isBlocked(c.env.BLOCKLIST, claimed.userId)) ||
      (await isMembershipBlocked(c.env.BLOCKLIST, claimed.userId, tenantId))
    ) {
      return c.json({ error: "blocked" }, 403);
    }
    const role = await currentRoleOfIssuer(
      c.env,
      tenantId,
      { userId: claimed.userId, tokenId: claimed.tokenId, tokenKind: claimed.tokenKind },
      new Date(),
    );
    if (role === null) {
      return c.json({ error: "token_revoked" }, 403);
    }
    if (!can(role, "record:write")) {
      return c.json({ error: "forbidden" }, 403);
    }
    const read = await readCapped(c.req.raw.body, MAX_ASSET_SIZE_BYTES);
    if (!read.ok) {
      return c.json({ error: "too_large" }, 413);
    }
    if (read.body.byteLength === 0) {
      return c.json({ error: "empty_body" }, 400);
    }
    // Content-Type は発行時に宣言したものを使う(要求のヘッダは信用しない)。発行に使ったトークンの
    // 認可コンテキストを組んで渡すので、asset の履歴は via mcp と tokenId を持つ(M5a-3)
    const auth: McpAuth = {
      userId: claimed.userId,
      role,
      tenantId,
      scopes: ["record:write"],
      tokenId: claimed.tokenId,
      tokenKind: claimed.tokenKind,
      exp: Math.floor(Date.now() / 1000),
    };
    const result = await storeAsset(c.env, tenantId, auth, {
      body: read.body,
      filename: claimed.filename,
      contentType: claimed.contentType,
    });
    if (!result.ok) {
      return c.json(
        { error: result.code, message: result.message },
        result.code === "forbidden" ? 403 : 422,
      );
    }
    return c.json({ assetId: result.record.id }, 201);
  },
);
