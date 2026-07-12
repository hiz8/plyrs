import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("control plane bindings smoke", () => {
  it("has the four migrated control-plane tables in D1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'd1_%' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toEqual(expect.arrayContaining(["memberships", "sessions", "tenants", "users"]));
  });

  it("reads and writes the blocklist KV namespace", async () => {
    await env.BLOCKLIST.put("smoke", "1");
    expect(await env.BLOCKLIST.get("smoke")).toBe("1");
  });

  it("exposes the test JWT secret", () => {
    expect(env.JWT_SECRET.length).toBeGreaterThan(0);
  });
});
