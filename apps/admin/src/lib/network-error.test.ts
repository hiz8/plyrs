import { describe, expect, it } from "vitest";
import { createApiClient } from "./api-client";
import { NetworkError, withNetworkErrors } from "./network-error";

describe("withNetworkErrors", () => {
  it("fetch の呼び出しが投げた TypeError を NetworkError に包む", async () => {
    const offline = withNetworkErrors(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await offline("/x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBeInstanceOf(TypeError);
  });

  it("TypeError 以外(中断など)はそのまま投げ直す", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const aborted = withNetworkErrors(async () => {
      throw abort;
    });
    await expect(aborted("/x")).rejects.toBe(abort);
  });

  it("api-client も fetch の失敗を NetworkError として返す", async () => {
    const api = createApiClient(async () => {
      throw new TypeError("Load failed");
    });
    await expect(api.listTenants()).rejects.toBeInstanceOf(NetworkError);
  });
});
