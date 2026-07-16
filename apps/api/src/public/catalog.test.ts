import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "./catalog";

describe("loadCatalog", () => {
  it("loads the projected field catalog into a map", async () => {
    const tenantId = crypto.randomUUID();
    const rows = [
      ["rating", "num", 0],
      ["tags", "text", 1],
      ["authors", "relation", 1],
    ] as const;
    for (const [fieldKey, kind, multi] of rows) {
      await env.PROJECTION_DB.prepare(
        "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', ?2, ?3, ?4, 0)",
      )
        .bind(tenantId, fieldKey, kind, multi)
        .run();
    }
    const catalog = await loadCatalog(env.PROJECTION_DB, tenantId, "post");
    expect(catalog.get("rating")).toStrictEqual({ kind: "num", multi: false });
    expect(catalog.get("tags")).toStrictEqual({ kind: "text", multi: true });
    expect(catalog.get("authors")).toStrictEqual({ kind: "relation", multi: true });
    expect(catalog.get("nope")).toBeUndefined();
  });

  it("returns an empty map for an unknown type (no rows)", async () => {
    const catalog = await loadCatalog(env.PROJECTION_DB, crypto.randomUUID(), "ghost");
    expect(catalog.size).toBe(0);
  });

  it("skips rows with an unknown kind (Phase 5c: forward-compat guard)", async () => {
    const tenantId = crypto.randomUUID();
    for (const [fieldKey, kind] of [
      ["location", "geo"],
      ["title", "text"],
    ] as const) {
      await env.PROJECTION_DB.prepare(
        "INSERT INTO projection_fields (tenant_id, type, field_key, kind, multi, projected_at) VALUES (?1, 'post', ?2, ?3, 0, 0)",
      )
        .bind(tenantId, fieldKey, kind)
        .run();
    }
    const catalog = await loadCatalog(env.PROJECTION_DB, tenantId, "post");
    expect(catalog.get("location")).toBeUndefined();
    expect(catalog.get("title")).toStrictEqual({ kind: "text", multi: false });
  });
});
