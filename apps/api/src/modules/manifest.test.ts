import { describe, expect, it } from "vitest";
import {
  moduleManifestSchema,
  moduleNavTypes,
  moduleOperation,
  type ModuleManifest,
} from "./manifest";
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

  it("description と navTypes は任意で、navTypes はマニフェスト内の型だけを指せる", () => {
    const described = { ...minimalManifest(), description: "デモの説明", navTypes: ["demo.item"] };
    expect(moduleManifestSchema.safeParse(described).success).toBe(true);
    const badNav = { ...minimalManifest(), navTypes: ["demo.ghost"] };
    expect(moduleManifestSchema.safeParse(badNav).success).toBe(false);
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

describe("moduleNavTypes (案 A 3.2)", () => {
  it("navTypes 省略時はモジュールの全型を出す", () => {
    const manifest = moduleManifestSchema.parse(minimalManifest()) as ModuleManifest;
    expect(moduleNavTypes(manifest)).toEqual(["demo.item"]);
  });

  it("navTypes があれば、その型だけをマニフェストの並び順で出す", () => {
    expect(
      moduleNavTypes({ ...BOOKING_MANIFEST, navTypes: ["booking.slot", "booking.resource"] }),
    ).toEqual(["booking.resource", "booking.slot"]);
  });

  it("予約モジュールは内部用の予約通知をサイドバーに出さない", () => {
    expect(moduleNavTypes(BOOKING_MANIFEST)).toEqual([
      "booking.resource",
      "booking.slot",
      "booking.reservation",
    ]);
  });
});

describe("BOOKING_MANIFEST の表示項目 (案 E 2 章 / G 5 章)", () => {
  it("モジュールの説明と、型の説明・全フィールドの表示名を持つ", () => {
    expect(BOOKING_MANIFEST.description).toBeTruthy();
    for (const type of BOOKING_MANIFEST.contentTypes.filter(
      (t) => t.key !== "booking.notification",
    )) {
      expect(type.description, type.key).toBeTruthy();
      for (const field of type.fields) {
        expect(field.label, `${type.key}.${field.key}`).toBeTruthy();
      }
    }
  });
});
