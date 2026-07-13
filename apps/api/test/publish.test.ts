import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asDeleteResult,
  asProjectionPayload,
  asPublishedPage,
  asPublishResult,
  asUnpublishResult,
  asWriteResult,
} from "./rpc-unwrap";

const TENANT = "tenant-publish";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

describe("publish / unpublish (design-spec §7)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    const registered = await stub.registerContentType(articleType(), auth("owner1"));
    expect(registered.ok).toBe(true);
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(100), input: validArticleInput() },
        auth("owner1"),
      ),
    );
    expect(written.ok).toBe(true);
  });

  it("freezes the record into a snapshot and queues an upsert job", async () => {
    const result = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.snapshot).toMatchObject({
      recordId: uuid(100),
      type: "article",
      publishedBy: "owner1",
      sourceVersion: 1,
    });
    // relations は publish 時点の凍結投影（design-spec §7）
    expect(result.snapshot.relations).toContainEqual(
      expect.objectContaining({ sourceField: "authors", targetType: "author", ordinal: 0 }),
    );

    const payload = asProjectionPayload(await stub.getProjectionPayload(uuid(100)));
    expect(payload).not.toBeNull();
    expect(payload?.slug).toBe("hello");
    expect(payload?.sourceVersion).toBe(1);
  });

  it("keeps the snapshot frozen while the record keeps changing", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const edited = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(100), input: { ...validArticleInput(), title: "編集後" } },
        auth("owner1"),
      ),
    );
    expect(edited.ok).toBe(true);

    const payload = asProjectionPayload(await stub.getProjectionPayload(uuid(100)));
    expect(payload?.data["title"]).toBe("こんにちは");
    expect(payload?.sourceVersion).toBe(1);
  });

  it("republish advances the snapshot's source version", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    await stub.writeRecord(
      "article",
      { recordId: uuid(100), input: { ...validArticleInput(), title: "編集後" } },
      auth("owner1"),
    );
    const republished = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      expect(republished.snapshot.sourceVersion).toBe(2);
      expect(republished.snapshot.data["title"]).toBe("編集後");
    }
  });

  it("unpublish removes the snapshot", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const result = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result).toMatchObject({ ok: true, sourceVersion: 1 });
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("rejects unpublish when nothing is published", async () => {
    const result = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result).toMatchObject({ ok: false, code: "not_published" });
  });

  it("refuses to publish a missing or deleted record", async () => {
    const missing = asPublishResult(await stub.publishRecord(TENANT, uuid(199), auth("owner1")));
    expect(missing).toMatchObject({ ok: false, code: "not_found" });

    await stub.deleteRecord(uuid(100), auth("owner1"));
    const deleted = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(deleted).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("cascades unpublish when a published record is deleted (裁定 2026-07-13)", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const deleted = asDeleteResult(await stub.deleteRecord(uuid(100), auth("owner1")));
    expect(deleted.ok).toBe(true);
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("denies publish to viewers and allows it to editors", async () => {
    const denied = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("mallory", "viewer")),
    );
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });

    const allowed = asPublishResult(
      await stub.publishRecord(TENANT, uuid(100), auth("eve", "editor")),
    );
    expect(allowed.ok).toBe(true);
  });
});

describe("outbox rows (design-spec §12.3)", () => {
  let stub: ReturnType<typeof freshStub>;

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(100), input: validArticleInput() },
        auth("owner1"),
      ),
    );
    expect(written.ok).toBe(true);
  });

  it("queues exactly one unsent upsert row on publish", async () => {
    const published = asPublishResult(await stub.publishRecord(TENANT, uuid(100), auth("owner1")));
    expect(published.ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ job_type: string; record_id: string; source_version: number; sent: number }>(
          "SELECT job_type, record_id, source_version, sent FROM outbox",
        )
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        job_type: "upsert",
        record_id: uuid(100),
        source_version: 1,
        sent: 0,
      });
    });
  });

  it("queues a delete row carrying the previously published version on unpublish", async () => {
    await stub.publishRecord(TENANT, uuid(100), auth("owner1"));
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(unpublished).toMatchObject({ ok: true, sourceVersion: 1 });
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ job_type: string; record_id: string; source_version: number }>(
          "SELECT job_type, record_id, source_version FROM outbox WHERE sent = 0 ORDER BY rowid",
        )
        .toArray();
      // publish が積んだ upsert 行 + unpublish が積んだ delete 行の 2 件が残る
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        job_type: "delete",
        record_id: uuid(100),
        source_version: 1,
      });
    });
  });

  it("adds no outbox row when deleting a record that was never published", async () => {
    const deleted = asDeleteResult(await stub.deleteRecord(uuid(100), auth("owner1")));
    expect(deleted.ok).toBe(true);
    await runInDurableObject(stub, async (_instance, state) => {
      const n = state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox").one().n;
      expect(n).toBe(0);
    });
  });
});

describe("getPublishedPage keyset pagination (Task 7 dependency)", () => {
  let stub: ReturnType<typeof freshStub>;
  const COUNT = 5;
  const ids = Array.from({ length: COUNT }, (_, i) => uuid(600 + i));

  beforeEach(async () => {
    stub = freshStub();
    await stub.registerContentType(articleType(), auth("owner1"));
    for (const [i, id] of ids.entries()) {
      const written = asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: id, input: { ...validArticleInput(), slug: `page-${i}` } },
          auth("owner1"),
        ),
      );
      expect(written.ok).toBe(true);
      const published = asPublishResult(await stub.publishRecord(TENANT, id, auth("owner1")));
      expect(published.ok).toBe(true);
    }
  });

  it("returns every published record exactly once, in record_id order", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < COUNT + 1; guard += 1) {
      const page = asPublishedPage(await stub.getPublishedPage(cursor, 2));
      seen.push(...page.payloads.map((payload) => payload.recordId));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(ids.toSorted());
  });

  it("returns an empty page with nextCursor null once a full page exhausts the rows", async () => {
    // limit を件数ぴったりに合わせる: payloads.length === limit だが後続行は無い境界ケース
    const full = asPublishedPage(await stub.getPublishedPage(null, COUNT));
    expect(full.payloads).toHaveLength(COUNT);
    expect(full.nextCursor).toBe(ids[COUNT - 1]);

    const after = asPublishedPage(await stub.getPublishedPage(full.nextCursor, COUNT));
    expect(after).toEqual({ payloads: [], nextCursor: null });
  });
});

import app from "../src/index";

const RUN_ID = crypto.randomUUID().slice(0, 8);
let n = 0;
function unique(prefix: string): string {
  n += 1;
  return `${prefix}${RUN_ID}-${n}`;
}

function json(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

async function bootstrapTenant(): Promise<{ tenantId: string; bearer: string }> {
  const email = `${unique("owner")}@example.com`;
  const signup = await app.request(
    "/auth/signup",
    json({ email, password: "hunter2hunter2" }),
    env,
  );
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const created = await app.request(
    "/v1/tenants",
    json({ name: "T", slug: unique("t-") }, { cookie }),
    env,
  );
  const { tenantId } = (await created.json()) as { tenantId: string };
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), env);
  const { token } = (await issued.json()) as { token: string };
  return { tenantId, bearer: `Bearer ${token}` };
}

describe("publish routes", () => {
  it("publishes and unpublishes through HTTP", async () => {
    const { tenantId, bearer } = await bootstrapTenant();
    const authHeader = { authorization: bearer };

    await app.request(
      `/v1/t/${tenantId}/content-types`,
      { ...json(articleType(), authHeader), method: "PUT" },
      env,
    );
    await app.request(
      `/v1/t/${tenantId}/records/article/${uuid(120)}`,
      { ...json({ input: validArticleInput() }, authHeader), method: "PUT" },
      env,
    );

    const published = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/publish`,
      json({}, authHeader),
      env,
    );
    expect(published.status).toBe(200);

    const unpublished = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/unpublish`,
      json({}, authHeader),
      env,
    );
    expect(unpublished.status).toBe(200);

    const again = await app.request(
      `/v1/t/${tenantId}/records/${uuid(120)}/unpublish`,
      json({}, authHeader),
      env,
    );
    expect(again.status).toBe(409);
  });
});
