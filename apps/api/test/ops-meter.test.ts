import { env } from "cloudflare:workers";
import { v7 as uuidv7 } from "uuid";
import { beforeAll, describe, expect, it } from "vitest";
import type { McpAuth } from "../src/do/authorize";
import type { InvokeMeter, InvokeResult } from "../src/ops/invoke";
import { articleType, auth, validArticleInput } from "./fixtures";
import { asInvokeResult, asWriteResult } from "./rpc-unwrap";

// M4-6(Review Focus 5、ロードマップ 6 章): 書き込み 1 回の rows read が record 数に比例しないこと。
// 10 件と 300 件のテナント(別 DO)で同じ操作の列を流し、各操作の rows read が一致することを確かめる。
// rows written は記録のみ(報告書の表に写す)。

const SMALL = 10;
const LARGE = 300;
const BODY_CHARS = 5000;
const LIST_LIMIT = 20;

function bodyOf(text: string) {
  return {
    schemaVersion: 1,
    doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
  };
}

async function seedTenant(count: number) {
  const tenantId = crypto.randomUUID();
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const owner = { ...auth("owner", "owner"), tenantId };
  expect((await stub.registerContentType(articleType(), owner)).ok).toBe(true);
  for (let i = 0; i < count; i += 1) {
    const written = asWriteResult(
      await stub.writeRecord(
        "article",
        {
          recordId: uuidv7(),
          input: { ...validArticleInput(), slug: `seed-${i}`, body: bodyOf("あ".repeat(200)) },
        },
        owner,
      ),
    );
    expect(written.ok).toBe(true);
  }
  return { tenantId, stub };
}

function agent(tenantId: string): McpAuth {
  return {
    userId: "agent",
    role: "owner",
    tenantId,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read", "record:write", "record:delete", "record:publish"],
    tokenId: "token-meter",
    tokenKind: "pat",
  };
}

type Meters = Record<string, InvokeMeter>;

// 同じ操作の列を流して、操作ごとの計測値を返す
async function runSequence(tenantId: string, stub: DurableObjectStub): Promise<Meters> {
  const meters: Meters = {};
  const call = async (label: string, op: string, input: unknown, options = {}) => {
    const result: InvokeResult = asInvokeResult(
      await (stub as unknown as { invoke: (...args: unknown[]) => Promise<unknown> }).invoke(
        op,
        input,
        agent(tenantId),
        options,
      ),
    );
    expect(result.ok, `${label}: ${JSON.stringify(result)}`).toBe(true);
    expect(result.meter).toBeDefined();
    meters[label] = result.meter!;
    if (process.env["DBG"] && tenantId === (globalThis as any).__big) {
      for (const [q, c] of (globalThis as any).__q)
        if (c.rowsRead > 5) console.log(label, c.rowsRead, q.slice(0, 300));
    }
    (globalThis as any).__q = [];
    return result.ok ? (result.output as Record<string, unknown>) : {};
  };
  const recordId = uuidv7();
  await call("record_create", "record_create", {
    type: "article",
    recordId,
    input: { ...validArticleInput(), slug: `target-${recordId}`, body: "## 見出し\n\n本文" },
  });
  const got = await call("record_get", "record_get", { recordId });
  await call("record_update", "record_update", {
    recordId,
    input: { body: bodyOf("い".repeat(BODY_CHARS)) },
    baseFieldVersions: got["fieldVersions"],
  });
  await call("record_list", "record_list", { type: "article", limit: LIST_LIMIT });
  await call("record_publish", "record_publish", { recordId }, { tenantSlug: "meter" });
  const history = await call("record_history", "record_history", { recordId });
  // 同じ利用者の 15 分以内の書き込みは 1 つの版にまとまる(16.5)ので、復元は削除の取り消しで測る
  // (削除済みからの復元は内容が同じでも書き込む)
  const items = history["items"] as { historySeq: number; kind: string }[];
  await call("record_delete", "record_delete", { recordId });
  await call("record_restore", "record_restore", {
    recordId,
    historySeq: items.find((item) => item.kind === "write")!.historySeq,
  });
  return meters;
}

let small: Meters;
let large: Meters;

beforeAll(async () => {
  const a = await seedTenant(SMALL);
  const b = await seedTenant(LARGE);
  small = await runSequence(a.tenantId, a.stub as never);
  (globalThis as any).__big = b.tenantId;
  large = await runSequence(b.tenantId, b.stub as never);
}, 120_000);

describe("操作ごとの rows read(M4-6)", () => {
  it("10 件と 300 件のテナントで、各操作の rows read が一致する(Review Focus 5)", () => {
    const table = Object.keys(small).map((op) => ({
      op,
      [`rowsRead(${SMALL})`]: small[op]!.rowsRead,
      [`rowsRead(${LARGE})`]: large[op]!.rowsRead,
      [`rowsWritten(${SMALL})`]: small[op]!.rowsWritten,
      [`rowsWritten(${LARGE})`]: large[op]!.rowsWritten,
    }));
    console.log(`ops-meter ${JSON.stringify(table)}`);
    // record_list はページの大きさ(limit + 1 行)に比例し、record 数には比例しない。ほかは一致する
    for (const op of Object.keys(small).filter((name) => name !== "record_list")) {
      expect(large[op]!.rowsRead, op).toBe(small[op]!.rowsRead);
    }
    expect(large["record_list"]!.rowsRead).toBeLessThanOrEqual(LIST_LIMIT + 1 + 1);
  });
});
