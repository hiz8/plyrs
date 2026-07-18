import { describe, expect, it } from "vitest";
import { moduleManifestSchema, moduleOperation } from "./manifest";
import { BOOKING_MANIFEST } from "./booking/manifest";

function minimalManifest() {
  return {
    moduleId: "demo",
    version: 1,
    name: "デモ",
    contentTypes: [
      {
        id: "00000000-0000-7000-8000-00000000d001",
        key: "demo.item",
        name: "アイテム",
        source: "plugin",
        pluginId: "demo",
        version: 1,
        fields: [{ key: "title", type: "text", required: true }],
      },
    ],
    permissions: [{ key: "manage", roles: ["owner"] }],
    typeWriteGuards: { "demo.item": "manage" },
    publicWriteTypes: ["demo.item"],
  };
}

describe("moduleManifestSchema", () => {
  it("整合したマニフェストを受理する", () => {
    expect(moduleManifestSchema.safeParse(minimalManifest()).success).toBe(true);
  });

  it("moduleId と一致しない pluginId の型を拒否する", () => {
    const bad = minimalManifest();
    const contentType = bad.contentTypes[0]!;
    contentType.pluginId = "other";
    contentType.key = "other.item";
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("source が plugin でない型を拒否する", () => {
    const bad = minimalManifest();
    const contentType = bad.contentTypes[0]!;
    contentType.source = "user";
    delete (contentType as Record<string, unknown>).pluginId;
    contentType.key = "item";
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("マニフェスト外の型を指す typeWriteGuards / publicWriteTypes を拒否する", () => {
    const badGuard = { ...minimalManifest(), typeWriteGuards: { "demo.ghost": "manage" } };
    expect(moduleManifestSchema.safeParse(badGuard).success).toBe(false);
    const badPublic = { ...minimalManifest(), publicWriteTypes: ["demo.ghost"] };
    expect(moduleManifestSchema.safeParse(badPublic).success).toBe(false);
  });

  it("未宣言の権限キーを指す typeWriteGuards を拒否する", () => {
    const bad = { ...minimalManifest(), typeWriteGuards: { "demo.item": "ghost" } };
    expect(moduleManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("moduleOperation は名前空間つき操作キーを作る", () => {
    expect(moduleOperation("booking", "manage")).toBe("booking:manage");
  });
});

describe("BOOKING_MANIFEST", () => {
  it("スキーマ検証を通る(4 型・manage 権限・reservation の公開 write 宣言)", () => {
    const parsed = moduleManifestSchema.safeParse(BOOKING_MANIFEST);
    expect(parsed.success).toBe(true);
    expect(BOOKING_MANIFEST.contentTypes.map((t) => t.key)).toEqual([
      "booking.resource",
      "booking.slot",
      "booking.reservation",
      "booking.notification",
    ]);
    expect(BOOKING_MANIFEST.publicWriteTypes).toEqual(["booking.reservation"]);
    expect(BOOKING_MANIFEST.typeWriteGuards).toEqual({
      "booking.reservation": "manage",
      "booking.notification": "manage",
    });
  });
});
