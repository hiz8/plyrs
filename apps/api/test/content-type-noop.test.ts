import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { asRegisterResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function articleType() {
  return {
    id: "00000000-0000-7000-8000-00000000c001",
    key: "article",
    name: "記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true, config: { maxLength: 200 } },
      { key: "body", type: "richtext" },
    ],
  };
}

describe("同一定義の再登録は no-op (§5 軽微の消化 / 冪等マニフェスト再配信の前提)", () => {
  it("同一定義の再登録で version が進まず applied: false が返る", async () => {
    const tenant = stub("ct-noop-1");
    const first = asRegisterResult(await tenant.registerContentType(articleType(), OWNER));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.applied).toBe(true);
    expect(first.contentType.version).toBe(1);

    const second = asRegisterResult(await tenant.registerContentType(articleType(), OWNER));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toBe(false);
    expect(second.contentType.version).toBe(1); // 進まない
  });

  it("定義が実際に変わったときは従来どおり version が進む", async () => {
    const tenant = stub("ct-noop-2");
    await tenant.registerContentType(articleType(), OWNER);
    const changed = {
      ...articleType(),
      fields: [...articleType().fields, { key: "summary", type: "text" }],
    };
    const result = asRegisterResult(await tenant.registerContentType(changed, OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(true);
    expect(result.contentType.version).toBe(2);
  });

  it("プロパティ記述順だけが違う同一定義も no-op になる(zod 正規化後比較)", async () => {
    const tenant = stub("ct-noop-3");
    await tenant.registerContentType(articleType(), OWNER);
    const reordered = {
      ...articleType(),
      fields: [
        { config: { maxLength: 200 }, required: true, type: "text", key: "title" },
        { type: "richtext", key: "body" },
      ],
    };
    const result = asRegisterResult(await tenant.registerContentType(reordered, OWNER));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toBe(false);
  });
});
