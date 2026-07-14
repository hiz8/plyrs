import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { articleType, auth, uuid } from "./fixtures";
import {
  authorType,
  deliverJobs,
  freshTenantSlug,
  postType,
  seedTenant,
  writeAndPublish,
} from "./public-helpers";

const authorA = uuid(420);
const authorB = uuid(421);
// record_id タイブレークを決定的にするため昇順の id を使う
const posts = [uuid(430), uuid(431), uuid(432), uuid(433), uuid(434)];

function postId(i: number): string {
  const id = posts[i];
  if (id === undefined) {
    throw new Error("fixture mismatch");
  }
  return id;
}

interface ListBody {
  items: { id: string; publishedAt: string; fields: Record<string, unknown> }[];
  included?: { id: string }[];
  nextCursor: string | null;
}

async function list(
  tenantSlug: string,
  query: string,
): Promise<{ status: number; body: ListBody }> {
  const response = await app.request(`/public/v1/${tenantSlug}/records/post${query}`, {}, env);
  return { status: response.status, body: (await response.json()) as ListBody };
}

async function walk(tenantSlug: string, baseQuery: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 10; i += 1) {
    const query = cursor === null ? baseQuery : `${baseQuery}&cursor=${encodeURIComponent(cursor)}`;
    const { status, body } = await list(tenantSlug, query);
    if (status !== 200) {
      throw new Error(`list failed: ${status}`);
    }
    ids.push(...body.items.map((item) => item.id));
    cursor = body.nextCursor;
    if (cursor === null) {
      return ids;
    }
  }
  throw new Error("cursor walk did not terminate");
}

describe("public list (§12.4 / §12.5)", () => {
  let tenantId: string;
  let tenantSlug: string;
  let stub: DurableObjectStub<TenantDO>;

  beforeEach(async () => {
    tenantId = crypto.randomUUID();
    tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(authorType(), auth("owner1"));
    await stub.registerContentType(postType(), auth("owner1"));
    const jobs: ProjectionJob[] = [
      await writeAndPublish(stub, tenantId, "author", authorA, { name: "A", slug: "wa" }),
      await writeAndPublish(stub, tenantId, "author", authorB, { name: "B", slug: "wb" }),
    ];
    // p0: rating5 tech [x]   authors[A]
    // p1: rating5 life [y]   authors[A,B]
    // p2: rating3 tech [x,y] authors[B]
    // p3: rating無し life [z] authors[]
    // p4: rating1 tech featured [x] authors[A]
    const inputs: Record<string, unknown>[] = [
      {
        title: "p0",
        slug: "s0",
        rating: 5,
        category: "tech",
        tags: ["x"],
        authors: [{ type: "author", id: authorA }],
      },
      {
        title: "p1",
        slug: "s1",
        rating: 5,
        category: "life",
        tags: ["y"],
        authors: [
          { type: "author", id: authorA },
          { type: "author", id: authorB },
        ],
      },
      {
        title: "p2",
        slug: "s2",
        rating: 3,
        category: "tech",
        tags: ["x", "y"],
        authors: [{ type: "author", id: authorB }],
      },
      { title: "p3", slug: "s3", category: "life", tags: ["z"], authors: [] },
      {
        title: "p4",
        slug: "s4",
        rating: 1,
        category: "tech",
        featured: true,
        tags: ["x"],
        authors: [{ type: "author", id: authorA }],
      },
    ];
    for (const [i, input] of inputs.entries()) {
      const id = posts[i];
      if (id === undefined) {
        throw new Error("fixture mismatch");
      }
      jobs.push(await writeAndPublish(stub, tenantId, "post", id, input));
    }
    await deliverJobs(jobs);
  });

  it("lists everything with the default sort and no included key", async () => {
    const { status, body } = await list(tenantSlug, "");
    expect(status).toBe(200);
    expect(body.items.length).toBe(5);
    expect(body.nextCursor).toBeNull();
    expect(body.included).toBeUndefined();
    // 既定ソート: システム published_at 降順・record_id 降順タイブレーク。
    // 期待順はレスポンス自身の publishedAt から計算して検証する（publish 時刻は制御できないため）
    const got = body.items.map((item) => item.id);
    const expected = [...body.items]
      .sort((a, b) =>
        a.publishedAt === b.publishedAt
          ? b.id.localeCompare(a.id)
          : b.publishedAt.localeCompare(a.publishedAt),
      )
      .map((item) => item.id);
    expect(got).toStrictEqual(expected);
    // 裁定（2026-07-14 controller amendment）: 一覧 items にも単体と同じく関係フィールドを
    // ID 配列として常時マージする（include の有無に関わらず）。ページ全体で 1 回チャンク内取得。
    const byId = new Map(body.items.map((item) => [item.id, item.fields]));
    expect(byId.get(postId(0))?.["authors"]).toStrictEqual([authorA]);
    expect(byId.get(postId(1))?.["authors"]).toStrictEqual([authorA, authorB]);
    expect(byId.get(postId(2))?.["authors"]).toStrictEqual([authorB]);
    // p3 は関係 0 件 —— projected_relations に行が無いため authors キー自体が現れない
    // （§6: 関係は data に入らない。単体取得と同じ挙動）
    expect(byId.get(postId(3))?.["authors"]).toBeUndefined();
    expect(byId.get(postId(4))?.["authors"]).toStrictEqual([authorA]);
  });

  it("walks the full set with limit=2 without gaps or duplicates", async () => {
    const ids = await walk(tenantSlug, "?limit=2");
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5);
  });

  it("sorts by an indexed number field in both directions, excluding value-less records", async () => {
    const desc = await walk(tenantSlug, "?sort=-rating&limit=2");
    expect(desc).toStrictEqual([posts[1], posts[0], posts[2], posts[4]]); // 5,5,3,1（p3 除外・同値は id 降順）
    const asc = await walk(tenantSlug, "?sort=rating&limit=2");
    expect(asc).toStrictEqual([posts[4], posts[2], posts[0], posts[1]]);
  });

  it("filters: any-of within a key, AND across keys, booleans, multi-select", async () => {
    const tech = await list(tenantSlug, "?filter[category]=tech");
    expect(tech.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[2], posts[4]].sort(),
    );
    const anyOf = await list(tenantSlug, "?filter[category]=tech&filter[category]=life");
    expect(anyOf.body.items.length).toBe(5);
    const combined = await list(tenantSlug, "?filter[category]=tech&filter[rating]=5");
    expect(combined.body.items.map((item) => item.id)).toStrictEqual([posts[0]]);
    const featured = await list(tenantSlug, "?filter[featured]=true");
    expect(featured.body.items.map((item) => item.id)).toStrictEqual([posts[4]]);
    const tagX = await list(tenantSlug, "?filter[tags]=x&filter[tags]=z"); // any-of（1値=1行）
    expect(tagX.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[2], posts[3], posts[4]].sort(),
    );
  });

  it("filters by relation membership", async () => {
    const byA = await list(tenantSlug, `?filter[authors]=${authorA}`);
    expect(byA.body.items.map((item) => item.id).sort()).toStrictEqual(
      [posts[0], posts[1], posts[4]].sort(),
    );
  });

  it("expands include=authors across the page, deduped", async () => {
    const { body } = await list(tenantSlug, "?include=authors");
    expect(body.included?.map((record) => record.id).sort()).toStrictEqual(
      [authorA, authorB].sort(),
    );
  });

  it("rejects bad queries with 400", async () => {
    for (const query of [
      "?filter[title]=x", // 索引宣言なし
      "?sort=tags", // 複数値ソートは未定義
      "?sort=authors",
      "?limit=0",
      "?limit=101",
      "?cursor=@@@",
      "?include=rating",
      "?unknown=1",
    ]) {
      const { status } = await list(tenantSlug, query);
      expect(status, query).toBe(400);
    }
  });

  it("stops listing a record once its unpublish delete lands", async () => {
    const target = posts[0];
    if (target === undefined) {
      throw new Error("fixture mismatch");
    }
    await stub.unpublishRecord(tenantId, target, auth("owner1"));
    // unpublish の delete ジョブは outbox の最終行から publish_seq を読む
    const row = await runInDurableObject(stub, async (_instance, state) => {
      const rows = state.storage.sql
        .exec<{ publish_seq: number; source_version: number }>(
          "SELECT publish_seq, source_version FROM outbox WHERE job_type = 'delete' ORDER BY rowid DESC LIMIT 1",
        )
        .toArray();
      const last = rows[0];
      if (last === undefined) {
        throw new Error("no delete outbox row");
      }
      return last;
    });
    await deliverJobs([
      {
        jobType: "delete",
        tenantId,
        recordId: target,
        sourceVersion: row.source_version,
        publishSeq: row.publish_seq,
      },
    ]);
    const { body } = await list(tenantSlug, "");
    expect(body.items.map((item) => item.id)).not.toContain(target);
    const single = await app.request(`/public/v1/${tenantSlug}/records/post/${target}`, {}, env);
    expect(single.status).toBe(404);
  });
});

// ロードマップ §9 / G4 と published_at シャドーイング: ユーザーが published_at という索引
// フィールドを宣言している型（fixtures の articleType）では、sort=published_at はシステム列
// ではなく宣言フィールド（projection_index）で並ぶ。
describe("public list published_at shadowing", () => {
  it("orders by the user-declared published_at field, not the publish timestamp", async () => {
    const tenantId = crypto.randomUUID();
    const tenantSlug = freshTenantSlug();
    await seedTenant(tenantId, tenantSlug);
    const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
    await stub.registerContentType(articleType(), auth("owner1"));
    const early = uuid(440);
    const late = uuid(441);
    // publish 順は early が後、宣言フィールドの値は early が古い —— 並びが値に従うことを見る
    const jobs = [
      await writeAndPublish(stub, tenantId, "article", late, {
        title: "遅",
        slug: "late",
        published_at: "2026-07-13T00:00:00.000Z",
        authors: [{ type: "author", id: uuid(442) }],
      }),
      await writeAndPublish(stub, tenantId, "article", early, {
        title: "早",
        slug: "early",
        published_at: "2026-01-01T00:00:00.000Z",
        authors: [{ type: "author", id: uuid(442) }],
      }),
    ];
    await deliverJobs(jobs);
    const response = await app.request(
      `/public/v1/${tenantSlug}/records/article?sort=-published_at`,
      {},
      env,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id)).toStrictEqual([late, early]);
  });
});
