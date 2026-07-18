import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ASSET_TYPE_DEFINITION, ASSET_TYPE_ID, ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { ensureAssetContentType } from "../src/do/ensure-asset-type";
import { asContentTypeRow, asRegisterResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

describe("システム asset 型の自動登録 (Phase 8 裁定 2)", () => {
  it("registers the asset type on DO construction", async () => {
    const tenant = stub("asset-type-auto");
    const row = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    expect(row).not.toBeNull();
    expect(row?.id).toBe(ASSET_TYPE_ID);
    expect(row?.source).toBe("system");
    expect(row?.fields).toEqual(ASSET_TYPE_DEFINITION.fields);
    expect(row?.version).toBe(1);
  });

  it("is idempotent: a second wake does not bump the version", async () => {
    const tenant = stub("asset-type-idempotent");
    const first = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    // ping で RPC を往復させても(同一インスタンス内)version が動かないことを確認する。
    // 完全な再構築の冪等性は ensureAssetContentType 自体の分岐(定義一致なら no-op)が担う。
    await tenant.ping();
    const second = asContentTypeRow(await tenant.getContentType(ASSET_TYPE_KEY));
    expect(second?.version).toBe(first?.version);
  });
});

describe("registerContentType の system ガード (Phase 8 改変防御の第一層)", () => {
  it("rejects registering a type with source 'system' via the RPC", async () => {
    const tenant = stub("asset-type-guard-1");
    const result = asRegisterResult(
      await tenant.registerContentType(
        {
          ...ASSET_TYPE_DEFINITION,
          key: "fake_system",
          id: "00000000-0000-7000-8000-00000000a55f",
        },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("rejects overwriting the existing system asset type via the RPC", async () => {
    const tenant = stub("asset-type-guard-2");
    const result = asRegisterResult(
      await tenant.registerContentType(
        { ...ASSET_TYPE_DEFINITION, source: "user", name: "乗っ取り" },
        OWNER,
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });
});

describe("ensureAssetContentType の skip 分岐 (Phase 8 以前から key='asset' を持つテナント)", () => {
  // DO 構築(blockConcurrencyWhile)は必ず ensureAssetContentType を先に走らせるため、
  // 「key='asset' が既にユーザー型として存在する」legacy 状態は公開 API からは作れない
  // (作れるなら、それ自体が別のバグになる)。asset-type.test.ts の既存様式(runInDurableObject +
  // 直接 SQL)にならい、構築済み DO の content_types 行を直接書き換えて legacy 状態を模擬し、
  // ensure-asset-type.ts の skip 分岐そのものを実引数付きで呼び出す。
  it("既存のユーザー型を上書きせず false を返す(throw せずテナントは機能し続ける)", async () => {
    const tenant = stub("asset-type-skip-legacy");
    await tenant.ping(); // 先に system 型の自動登録を完了させる

    const legacyId = "00000000-0000-7000-8000-0000000000aa";
    await runInDurableObject(tenant, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE content_types SET id = ?, name = 'legacy', source = 'user', fields = '[]' WHERE key = 'asset'",
        legacyId,
      );
      const changed = ensureAssetContentType(state.storage.sql, new Date().toISOString());
      expect(changed).toBe(false);
      const row = state.storage.sql
        .exec<{ id: string; source: string }>(
          "SELECT id, source FROM content_types WHERE key = 'asset'",
        )
        .one();
      // 既存のユーザー型がそのまま残っている(system 型に上書きされていない)
      expect(row).toEqual({ id: legacyId, source: "user" });
    });

    // テナントは(アセット機能こそ使えないが)壊れずに動作し続ける
    expect(await tenant.ping()).toBe("pong");
  });
});
