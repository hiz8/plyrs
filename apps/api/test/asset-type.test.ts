import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ASSET_TYPE_DEFINITION, ASSET_TYPE_ID, ASSET_TYPE_KEY } from "@plyrs/metamodel";
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
