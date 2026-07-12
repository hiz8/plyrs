import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TenantDO } from "../src/tenant-do";

// ストレージ分離はテストファイル単位のため、テストごとに DO 名を変えて独立させる
function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("TenantDO smoke", () => {
  it("answers ping over RPC", async () => {
    expect(await freshStub().ping()).toBe("pong");
  });

  it("runs migrations on construction (core tables exist)", async () => {
    const stub = freshStub();
    await stub.ping();
    await runInDurableObject(stub, async (instance, state) => {
      expect(instance).toBeInstanceOf(TenantDO);
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .toArray()
        .map((row) => row.name);
      expect(tables).toEqual(expect.arrayContaining(["content_types", "records", "relations"]));
    });
  });

  it("bundles @plyrs/metamodel into the DO (monorepo TS exports probe)", async () => {
    const result = await freshStub().validateContentTypeInput({ nonsense: true });
    expect(result).toEqual({ valid: false });
  });
});
