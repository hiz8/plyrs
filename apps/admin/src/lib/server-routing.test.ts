import { describe, expect, it } from "vitest";
import { resolveServerRoute } from "./server-routing";

// server.ts は cloudflare:workers を import するため vitest で直接テストできない —
// 判定だけこの純関数に切り出してテストする(api-paths.ts と同じ理由)。
describe("resolveServerRoute", () => {
  it("routes document GET requests with Accept: text/html to the shell", () => {
    const request = new Request("https://admin.example.com/super-login", {
      headers: { Accept: "text/html" },
    });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("shell");
  });

  it("routes document GET requests carrying only Sec-Fetch-Dest: document to the shell", () => {
    const request = new Request("https://admin.example.com/tenants", {
      headers: { "Sec-Fetch-Dest": "document" },
    });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("shell");
  });

  it("routes /auth/... to api via isApiPath", () => {
    const request = new Request("https://admin.example.com/auth/turnstile-config", {
      headers: { Accept: "text/html" },
    });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("api");
  });

  it("routes /v1/... WebSocket upgrade requests to api", () => {
    const request = new Request("https://admin.example.com/v1/t/abc/sync", {
      headers: { Upgrade: "websocket" },
    });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("api");
  });

  it("routes POST /auth/login to api", () => {
    const request = new Request("https://admin.example.com/auth/login", { method: "POST" });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("api");
  });

  it("does not shell-ify non-document GET requests (e.g. bundled assets)", () => {
    const request = new Request("https://admin.example.com/assets/index-xxxx.js", {
      headers: { Accept: "*/*" },
    });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("ssr");
  });

  it("forwards /public/v1/... to api only when devProxyPublic is true", () => {
    const request = new Request("https://admin.example.com/public/v1/blog/records/post");
    expect(resolveServerRoute(request, { devProxyPublic: true })).toBe("api");
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("ssr");
  });

  it("routes non-API POST requests to ssr", () => {
    const request = new Request("https://admin.example.com/tenants", { method: "POST" });
    expect(resolveServerRoute(request, { devProxyPublic: false })).toBe("ssr");
  });
});
