import { describe, expect, it, vi } from "vitest";
import { createAssetServices } from "./asset-services";
import type { AdminApi } from "./admin-api";

// AssetServices が触るメソッド以外が呼ばれたら落ちる guard。
const rejectUnexpectedCall = () => Promise.reject(new Error("unexpected call"));

function stubAdminApi(overrides: Partial<AdminApi>): AdminApi {
  // AssetServices が触るメソッドだけ差し替える(残りは呼ばれたら落ちる guard)。
  return {
    uploadAsset: rejectUnexpectedCall,
    fetchAssetBlob: rejectUnexpectedCall,
    ...overrides,
  } as AdminApi;
}

describe("createAssetServices (Phase 8)", () => {
  it("uploads through the admin api", async () => {
    const uploadAsset = vi.fn(async () => ({ id: "a1" }));
    const services = createAssetServices(stubAdminApi({ uploadAsset }), "t1", () => "blob:unused");
    const file = new File([Uint8Array.from([1])], "a.png", { type: "image/png" });
    expect(await services.upload(file)).toEqual({ id: "a1" });
    expect(uploadAsset).toHaveBeenCalledWith("t1", file);
  });

  it("memoizes resolveUrl per asset id and returns null on failure", async () => {
    const fetchAssetBlob = vi.fn(async () => new Blob([Uint8Array.from([1, 2])]));
    const createUrl = vi.fn(() => "blob:one");
    const services = createAssetServices(stubAdminApi({ fetchAssetBlob }), "t1", createUrl);
    expect(await services.resolveUrl("a1")).toBe("blob:one");
    expect(await services.resolveUrl("a1")).toBe("blob:one");
    expect(fetchAssetBlob).toHaveBeenCalledTimes(1);

    const failing = createAssetServices(
      stubAdminApi({ fetchAssetBlob: async () => Promise.reject(new Error("401")) }),
      "t1",
      createUrl,
    );
    expect(await failing.resolveUrl("a2")).toBeNull();
  });
});
