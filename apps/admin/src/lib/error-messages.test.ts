import { describe, expect, it } from "vitest";
import { ApiError } from "./api-client";
import { ERROR_MESSAGES, NETWORK_ERROR_MESSAGE, errorCodeOf, errorMessage } from "./error-messages";
import { SuperApiError } from "./super-api";

const FALLBACK = "保存できませんでした。もう一度お試しください";

describe("errorMessage", () => {
  it("ApiError のコードを利用者向けの文に置き換える", () => {
    expect(errorMessage(new ApiError(403, "forbidden", "raw detail"), FALLBACK)).toBe(
      ERROR_MESSAGES.forbidden,
    );
  });

  it("API のエラー文(detail)を画面に出さない", () => {
    const message = errorMessage(
      new ApiError(400, "validation_failed", "title: Required"),
      FALLBACK,
    );
    expect(message).not.toContain("title: Required");
    expect(message).not.toContain("validation_failed");
  });

  it("SuperApiError と同期の拒否({ code })もコードで引く", () => {
    expect(errorMessage(new SuperApiError(409, "slug_taken"), FALLBACK)).toBe(
      ERROR_MESSAGES.slug_taken,
    );
    const rejected = Object.assign(new Error("dup"), {
      name: "SyncRejectedError",
      code: "unique_violation",
    });
    expect(errorMessage(rejected, FALLBACK)).toBe(ERROR_MESSAGES.unique_violation);
  });

  it("対応表に無いコードは汎用の文にする", () => {
    expect(errorMessage(new ApiError(500, "internal_error"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new ApiError(502, "unknown_error"), FALLBACK)).toBe(FALLBACK);
  });

  it("プロトタイプのプロパティ名をコードとして引かない", () => {
    expect(errorMessage(new ApiError(400, "toString"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(new ApiError(400, "__proto__"), FALLBACK)).toBe(FALLBACK);
  });

  it("fetch のネットワークの失敗(TypeError)は接続の確認を促す", () => {
    expect(errorMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("コードの無い例外や Error 以外の値は汎用の文にする", () => {
    expect(errorMessage(new Error("boom"), FALLBACK)).toBe(FALLBACK);
    expect(errorMessage("boom", FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });
});

describe("errorCodeOf", () => {
  it("code が文字列でなければ undefined", () => {
    expect(errorCodeOf({ code: 1 })).toBeUndefined();
    expect(errorCodeOf(null)).toBeUndefined();
  });
});
