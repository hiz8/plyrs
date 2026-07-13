import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("projection D1 binding", () => {
  it("has the three projection tables migrated", async () => {
    const { results } = await env.PROJECTION_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((row) => row.name);
    expect(names).toContain("projected_records");
    expect(names).toContain("projected_relations");
    expect(names).toContain("projection_index");
  });

  it("is a different database from the control plane", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projected_records'",
    ).all<{ name: string }>();
    expect(results).toHaveLength(0);
  });
});
