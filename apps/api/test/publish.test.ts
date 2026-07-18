import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { purgeSent } from "../src/do/outbox";
import type { AuthContext } from "../src/do/authorize";
import { insertTenantWithOwner } from "./create-tenant";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { fakeLimiter } from "./rate-limit-helper";
import {
  asDeleteResult,
  asProjectionPayload,
  asPublishedPage,
  asPublicationState,
  asPublishResult,
  asRegisterResult,
  asUnpublishResult,
  asWriteResult,
} from "./rpc-unwrap";

const TENANT = "tenant-publish";

// §6: AUTH_LIMITER は本物の Miniflare シミュレート ratelimit(--no-isolate で全ファイル共有)。
// signup を叩く bootstrapTenant はこの env を使う(素の env だと他テストの呼び出し数次第で 429 が混入する)。
const authEnv: Env = { ...env, AUTH_LIMITER: fakeLimiter(true) };

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

// Phase 8 の追加テスト（asset-guard.test.ts / asset-type.test.ts の様式に合わせる）:
// 名前付きの DO を立て、任意の tenantSlug を publishRecord に渡して埋め込み URL を検証する。
const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function namedStub(name: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(name));
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
    const result = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
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
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
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
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    await stub.writeRecord(
      "article",
      { recordId: uuid(100), input: { ...validArticleInput(), title: "編集後" } },
      auth("owner1"),
    );
    const republished = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      expect(republished.snapshot.sourceVersion).toBe(2);
      expect(republished.snapshot.data["title"]).toBe("編集後");
    }
  });

  it("unpublish removes the snapshot", async () => {
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    const result = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result).toMatchObject({ ok: true, sourceVersion: 1 });
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("rejects unpublish when nothing is published", async () => {
    const result = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(result).toMatchObject({ ok: false, code: "not_published" });
  });

  it("refuses to publish a missing or deleted record", async () => {
    const missing = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(199), auth("owner1")),
    );
    expect(missing).toMatchObject({ ok: false, code: "not_found" });

    await stub.deleteRecord(uuid(100), auth("owner1"));
    const deleted = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(deleted).toMatchObject({ ok: false, code: "record_deleted" });
  });

  it("cascades unpublish when a published record is deleted (裁定 2026-07-13)", async () => {
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    const deleted = asDeleteResult(await stub.deleteRecord(uuid(100), auth("owner1")));
    expect(deleted.ok).toBe(true);
    expect(asProjectionPayload(await stub.getProjectionPayload(uuid(100)))).toBeNull();
  });

  it("denies publish to viewers and allows it to editors", async () => {
    const denied = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("mallory", "viewer")),
    );
    expect(denied).toMatchObject({ ok: false, code: "forbidden" });

    const allowed = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("eve", "editor")),
    );
    expect(allowed.ok).toBe(true);
  });

  it("reports the publication state for the admin panel (Phase 6b)", async () => {
    expect(asPublicationState(await stub.getPublication(uuid(100)))).toStrictEqual({
      published: false,
    });
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(published.ok).toBe(true);
    const state = asPublicationState(await stub.getPublication(uuid(100)));
    expect(state).toMatchObject({ published: true, sourceVersion: 1, publishedBy: "owner1" });
    const un = asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")));
    expect(un.ok).toBe(true);
    expect(asPublicationState(await stub.getPublication(uuid(100)))).toStrictEqual({
      published: false,
    });
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

  // Task 6: DO は publish のコミット直後に producer としてアウトボックスを排出する。
  // 行自体は sweeper の purgeSent() が掃くまで残るが、sent は 1 になっている。
  it("queues exactly one upsert row on publish and the producer drains it immediately", async () => {
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
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
        sent: 1,
      });
    });
  });

  it("queues a delete row carrying the previously published version on unpublish, both drained", async () => {
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(unpublished).toMatchObject({ ok: true, sourceVersion: 1 });
    await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ job_type: string; record_id: string; source_version: number; sent: number }>(
          "SELECT job_type, record_id, source_version, sent FROM outbox ORDER BY rowid",
        )
        .toArray();
      // publish が積んだ upsert 行 + unpublish が積んだ delete 行の 2 件が残る
      // （producer が両方とも即時排出するので sent = 1。行自体は sweeper の purgeSent() 待ち）
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ job_type: "upsert", sent: 1 });
      expect(rows[1]).toMatchObject({
        job_type: "delete",
        record_id: uuid(100),
        source_version: 1,
        sent: 1,
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

  // CRITICAL fix（レビュー指摘）: publish_seq の起動時復元は published_snapshots と outbox の
  // 両方の MAX を取らねばならない。unpublish は snapshot 行を消すので、snapshot 側だけを見て
  // 復元すると番号が 0 に巻き戻り、republish が既に送出済みの delete と同じ番号を再び採ってしまい
  // このバグを再び開けてしまう。
  it("restores publish_seq from outbox after eviction even when published_snapshots is empty", async () => {
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(published.ok).toBe(true);
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);

    // この時点で published_snapshots は空。snapshot 側だけを見ると MAX は 0 に巻き戻る。
    await runInDurableObject(stub, async (_instance, state) => {
      const n = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM published_snapshots")
        .one().n;
      expect(n).toBe(0);
      const maxSeq = state.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(publish_seq) AS max_seq FROM outbox")
        .one().max_seq;
      expect(maxSeq).toBe(2); // upsert(1) + delete(2)
    });

    await evictDurableObject(stub, { webSockets: "hibernate" });

    const republished = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      // 巻き戻っていれば republish は publish_seq=1 を再び採り、送出済みの upsert(v1) と同じ番号の
      // delete(v1) を消せなくする順序ガードが機能しなくなる
      expect(republished.snapshot.publishSeq).toBeGreaterThan(2);
    }
  });

  // CRITICAL fix（レビュー指摘・再現済み）: published_snapshots と outbox の MAX に頼る復元は、
  // 両方の行が消えた後では床にすらならない。unpublish で snapshot 行は消え、purgeSent()
  // （Task 6 のスイーパーが sent=1 の outbox 行を定期的に掃除する経路）で outbox 行も消えたら、
  // 起動時 MAX スキャンは両方とも 0 を返し番号が巻き戻る。do_config に永続化した値だけがこの穴を塞ぐ。
  it("does not let publish_seq rewind after unpublish, an outbox purge, and eviction", async () => {
    const published = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(published.ok).toBe(true);
    const unpublished = asUnpublishResult(
      await stub.unpublishRecord(TENANT, uuid(100), auth("owner1")),
    );
    expect(unpublished.ok).toBe(true);

    // purge する前に、これまで発行済みの世代番号の上限を記録しておく（upsert(1) + delete(2)）。
    const maxIssuedBeforePurge = await runInDurableObject(stub, async (_instance, state) => {
      return state.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(publish_seq) AS max_seq FROM outbox")
        .one().max_seq;
    });
    expect(maxIssuedBeforePurge).toBe(2);

    // 実運用の掃除経路を辿る: 配信済みに印を付けてから purgeSent() で sent=1 の行を消す
    // （outbox.ts の purgeSent。Task 6 のスイーパーが routinely 呼ぶ経路そのもの）。
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec("UPDATE outbox SET sent = 1");
      purgeSent(state.storage.sql);
    });

    // この時点で published_snapshots も outbox も空。MAX スキャンだけに頼る復元は 0 に巻き戻る。
    await runInDurableObject(stub, async (_instance, state) => {
      const snapshotCount = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM published_snapshots")
        .one().n;
      expect(snapshotCount).toBe(0);
      const outboxCount = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM outbox")
        .one().n;
      expect(outboxCount).toBe(0);
    });

    await evictDurableObject(stub, { webSockets: "hibernate" });

    const republished = asPublishResult(
      await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1")),
    );
    expect(republished.ok).toBe(true);
    if (republished.ok) {
      // 巻き戻っていれば republish は publish_seq=1 を再び採ってしまう。過去に発行した最大値
      // （upsert=1, delete=2）より必ず大きくなければならない。
      expect(republished.snapshot.publishSeq).toBeGreaterThan(maxIssuedBeforePurge ?? 0);
    }
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
      const published = asPublishResult(
        await stub.publishRecord(TENANT, TENANT, id, auth("owner1")),
      );
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

import { app } from "../src/index";

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
    authEnv,
  );
  const { userId } = (await signup.json()) as { userId: string };
  const cookie = (signup.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  const { tenantId } = await insertTenantWithOwner(userId, { slug: unique("t-") });
  const issued = await app.request("/auth/token", json({ tenantId }, { cookie }), authEnv);
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

describe("publish のアセット統合 (Phase 8 裁定 4, 7)", () => {
  const mediaArticleType = {
    id: "018f2b6a-7a0a-7000-8000-00000000c001",
    key: "media_article",
    name: "メディア記事",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      {
        key: "hero",
        type: "relation",
        config: { allowedTypes: ["asset"], cardinality: "one", snapshotEmbed: "value" },
      },
      { key: "body", type: "richtext" },
    ],
  };

  async function setupArticleWithAsset(name: string) {
    const tenant = namedStub(name);
    const registered = asRegisterResult(await tenant.registerContentType(mediaArticleType, OWNER));
    expect(registered.ok).toBe(true);
    const assetId = uuidv7();
    const created = asWriteResult(
      await tenant.createAssetRecord(
        {
          recordId: assetId,
          input: {
            filename: "hero.png",
            content_type: "image/png",
            size: 100,
            r2_key: `${name}/${assetId}`,
            width: 800,
            height: 600,
            alt: "ヒーロー",
          },
        },
        OWNER,
      ),
    );
    expect(created.ok).toBe(true);
    const articleId = uuidv7();
    const written = asWriteResult(
      await tenant.writeRecord(
        "media_article",
        {
          recordId: articleId,
          input: { title: "記事", hero: { type: "asset", id: assetId } },
        },
        OWNER,
      ),
    );
    expect(written.ok).toBe(true);
    return { tenant, assetId, articleId };
  }

  it("cascades publish to referenced unpublished assets in the same transaction", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-cascade");
    const result = asPublishResult(
      await tenant.publishRecord("publish-cascade", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    const assetPublication = asPublicationState(await tenant.getPublication(assetId));
    expect(assetPublication.published).toBe(true);
    // outbox には記事と asset の 2 ジョブが積まれている(排出済みなら pendingOutbox は 0 でも
    // よい — 投影ペイロードが両方取れることを確認する)
    expect(asProjectionPayload(await tenant.getProjectionPayload(assetId))).not.toBeNull();
    expect(asProjectionPayload(await tenant.getProjectionPayload(articleId))).not.toBeNull();
  });

  it("freezes the asset embed on snapshotEmbed value relations", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-embed");
    const result = asPublishResult(
      await tenant.publishRecord("publish-embed", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heroRow = result.snapshot.relations.find((row) => row.sourceField === "hero");
    expect(heroRow?.embed).toEqual({
      url: `/public/v1/blog/assets/${assetId}`,
      filename: "hero.png",
      contentType: "image/png",
      alt: "ヒーロー",
      width: 800,
      height: 600,
    });
  });

  it("does not republish an already-published asset (publish_seq が進まない)", async () => {
    const { tenant, assetId, articleId } = await setupArticleWithAsset("publish-no-repub");
    asPublishResult(await tenant.publishRecord("publish-no-repub", "blog", assetId, OWNER));
    const before = asProjectionPayload(await tenant.getProjectionPayload(assetId));
    asPublishResult(await tenant.publishRecord("publish-no-repub", "blog", articleId, OWNER));
    const after = asProjectionPayload(await tenant.getProjectionPayload(assetId));
    expect(after?.publishSeq).toBe(before?.publishSeq);
  });

  it("dangling asset references freeze embed: null (ソフト参照)", async () => {
    const tenant = namedStub("publish-dangling");
    asRegisterResult(await tenant.registerContentType(mediaArticleType, OWNER));
    const articleId = uuidv7();
    asWriteResult(
      await tenant.writeRecord(
        "media_article",
        {
          recordId: articleId,
          input: {
            title: "記事",
            hero: { type: "asset", id: "018f2b6a-7a0a-7000-8000-00000000dead" },
          },
        },
        OWNER,
      ),
    );
    const result = asPublishResult(
      await tenant.publishRecord("publish-dangling", "blog", articleId, OWNER),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heroRow = result.snapshot.relations.find((row) => row.sourceField === "hero");
    expect(heroRow?.embed).toBeNull();
  });
});
