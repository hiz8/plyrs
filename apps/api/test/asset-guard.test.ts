import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { ASSET_TYPE_KEY } from "@plyrs/metamodel";
import { asWriteResult } from "../src/rpc-unwrap";
import type { AuthContext } from "../src/do/authorize";

const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function stub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
}

function assetInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    filename: "hero.png",
    content_type: "image/png",
    size: 1234,
    r2_key: "t1/asset-1",
    width: 800,
    height: 600,
    ...overrides,
  };
}

describe("asset の改変防御 (Phase 8 裁定 2: assetGuardHook)", () => {
  it("createAssetRecord (system write) creates an asset record", async () => {
    const tenant = stub("asset-guard-create");
    const id = uuidv7();
    const result = asWriteResult(
      await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.type).toBe(ASSET_TYPE_KEY);
      expect(result.record.data["r2_key"]).toBe("t1/asset-1");
    }
  });

  it("rejects creating an asset record via the client write path", async () => {
    const tenant = stub("asset-guard-client-create");
    const result = asWriteResult(
      await tenant.writeRecord(ASSET_TYPE_KEY, { recordId: uuidv7(), input: assetInput() }, OWNER),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("rejects client edits to system-managed fields but allows alt/caption", async () => {
    const tenant = stub("asset-guard-edit");
    const id = uuidv7();
    const created = asWriteResult(
      await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER),
    );
    expect(created.ok).toBe(true);

    // alt / caption の編集は許可(ユーザー編集可 — 論点E)
    const altEdit = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        { recordId: id, input: assetInput({ alt: "ヒーロー画像", caption: "見出し" }) },
        OWNER,
      ),
    );
    expect(altEdit.ok).toBe(true);

    // r2_key の挿げ替えは拒否
    const hijack = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        {
          recordId: id,
          input: assetInput({ alt: "ヒーロー画像", caption: "見出し", r2_key: "t1/other" }),
        },
        OWNER,
      ),
    );
    expect(hijack.ok).toBe(false);
    if (!hijack.ok) {
      expect(hijack.code).toBe("forbidden");
      expect(hijack.message).toContain("r2_key");
    }
  });

  it("rejects dropping a system-managed optional field (width) via the client path", async () => {
    const tenant = stub("asset-guard-drop");
    const id = uuidv7();
    asWriteResult(await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER));
    const { width: _width, ...withoutWidth } = assetInput();
    const result = asWriteResult(
      await tenant.writeRecord(ASSET_TYPE_KEY, { recordId: id, input: withoutWidth }, OWNER),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("forbidden");
    }
  });

  it("status-only changes on assets pass the guard (LWW 経路を塞がない)", async () => {
    const tenant = stub("asset-guard-status");
    const id = uuidv7();
    asWriteResult(await tenant.createAssetRecord({ recordId: id, input: assetInput() }, OWNER));
    const result = asWriteResult(
      await tenant.writeRecord(
        ASSET_TYPE_KEY,
        { recordId: id, input: assetInput(), status: "ready" },
        OWNER,
      ),
    );
    expect(result.ok).toBe(true);
  });
});
