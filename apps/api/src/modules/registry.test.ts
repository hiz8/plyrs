import { describe, expect, it } from "vitest";
import { bookingModule } from "./booking/module";
import { buildModuleRegistry, MODULE_REGISTRY } from "./registry";

describe("buildModuleRegistry", () => {
  it("登録済みモジュールはマニフェスト検証を通っている", () => {
    expect(Object.keys(MODULE_REGISTRY)).toEqual(["booking"]);
  });

  it("navTypes に存在しない型があれば登録時に throw する", () => {
    const typo = {
      ...bookingModule,
      manifest: { ...bookingModule.manifest, navTypes: ["booking.slto"] },
    };
    expect(() => buildModuleRegistry([typo])).toThrow(/booking\.slto/);
  });

  it("typeWriteGuards が未知の権限を指していれば throw する", () => {
    const bad = {
      ...bookingModule,
      manifest: {
        ...bookingModule.manifest,
        typeWriteGuards: { "booking.reservation": "missing" },
      },
    };
    expect(() => buildModuleRegistry([bad])).toThrow(/missing/);
  });

  it("moduleId が重複していれば throw する", () => {
    expect(() => buildModuleRegistry([bookingModule, bookingModule])).toThrow(
      /duplicate module id: booking/,
    );
  });
});
