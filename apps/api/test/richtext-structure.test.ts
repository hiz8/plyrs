import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ClientChange } from "@plyrs/sync-protocol";
import type { McpAuth } from "../src/do/authorize";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import { asInvokeResult, asRecordSnapshot, asWriteResult } from "./rpc-unwrap";
import { nextMessage, nextMessages, openSyncSocket } from "./ws-helpers";

// M5a-6(design-spec 16.10): 書き込み時のリッチテキストの構造の検査。語彙に無いノード・マークと、既知の
// ノード・マークの余分な属性を、同期の push・REST(writeRecord RPC)・MCP(record_update)のどれでも拒否する。
// 既存の不正な本文を持つ record のタイトルだけを直す保存は通り、エディタが作る本文は通る。

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000e1";

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

function mcpAuth(): McpAuth {
  return {
    userId: "agent",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 3600,
    scopes: ["record:read", "record:write"],
    tokenId: uuid(760),
    tokenKind: "pat",
  };
}

function bodyOf(content: unknown[]) {
  return { schemaVersion: 2, doc: { type: "doc", content } };
}

const INVALID_BODIES: Array<[string, unknown[]]> = [
  ["語彙に無い iframe", [{ type: "iframe", attrs: { src: "javascript:alert(1)" } }]],
  [
    "段落に余分な src",
    [{ type: "paragraph", attrs: { id: "p1", src: "javascript:alert(1)" }, content: [] }],
  ],
  [
    "assetImage に onerror",
    [
      {
        type: "assetImage",
        attrs: { id: "a1", recordType: "asset", recordId: uuid(761), label: "x", onerror: "x()" },
      },
    ],
  ],
  [
    "link マークに onclick",
    [
      {
        type: "paragraph",
        attrs: { id: "p1" },
        content: [
          {
            type: "text",
            text: "リンク",
            marks: [{ type: "link", attrs: { href: "https://example.com", onclick: "x()" } }],
          },
        ],
      },
    ],
  ],
  [
    "語彙に無いマーク",
    [
      {
        type: "paragraph",
        content: [{ type: "text", text: "x", marks: [{ type: "highlight" }] }],
      },
    ],
  ],
];

// エディタ(UniqueID を含む拡張の集合)が作る形: 最上位と入れ子の段落の id、assetImage、recordMention、
// link マーク(Tiptap の Link の属性一式)
const EDITOR_BODY = bodyOf([
  {
    type: "heading",
    attrs: { id: "h-1", level: 2 },
    content: [{ type: "text", text: "見出し" }],
  },
  {
    type: "paragraph",
    attrs: { id: "p-1" },
    content: [
      { type: "text", text: "著者 " },
      {
        type: "recordMention",
        attrs: { recordType: "author", recordId: uuid(762), label: "山田" },
      },
      {
        type: "text",
        text: "のリンク",
        marks: [
          {
            type: "link",
            attrs: {
              href: "https://example.com",
              target: "_blank",
              rel: "noopener noreferrer nofollow",
              class: null,
            },
          },
          { type: "bold" },
        ],
      },
    ],
  },
  {
    type: "bulletList",
    attrs: { id: "l-1" },
    content: [
      {
        type: "listItem",
        content: [
          { type: "paragraph", attrs: { id: "p-2" }, content: [{ type: "text", text: "項目" }] },
        ],
      },
    ],
  },
  {
    type: "assetImage",
    attrs: { id: "a-1", recordType: "asset", recordId: uuid(763), label: "hero.png" },
  },
]);

async function seeded() {
  const stub = freshStub();
  await stub.registerContentType(articleType(), auth("admin"));
  const created = asWriteResult(
    await stub.writeRecord(
      "article",
      { recordId: uuid(764), input: validArticleInput() },
      auth("a"),
    ),
  );
  expect(created.ok).toBe(true);
  return stub;
}

async function viaRest(stub: Awaited<ReturnType<typeof seeded>>, body: unknown) {
  return asWriteResult(
    await stub.writeRecord(
      "article",
      { recordId: uuid(764), input: { ...validArticleInput(), body } },
      auth("a"),
    ),
  );
}

async function viaMcp(stub: Awaited<ReturnType<typeof seeded>>, body: unknown) {
  const got = asInvokeResult(await stub.invoke("record_get", { recordId: uuid(764) }, mcpAuth()));
  const fieldVersions = got.ok ? (got.output as { fieldVersions: unknown }).fieldVersions : {};
  return asInvokeResult(
    await stub.invoke(
      "record_update",
      { recordId: uuid(764), input: { body }, baseFieldVersions: fieldVersions },
      mcpAuth(),
    ),
  );
}

async function viaSync(stub: Awaited<ReturnType<typeof seeded>>, body: unknown) {
  const { socket } = await openSyncSocket(stub, {
    userId: "a",
    role: "editor",
    tenantId: TENANT,
    exp: Math.floor(Date.now() / 1000) + 900,
  });
  socket.send(JSON.stringify({ type: "hello", checkpoint: 0 }));
  await nextMessages(socket, 2);
  const current = asRecordSnapshot(await stub.getRecord(uuid(764)));
  const pushed: ClientChange = {
    changeId: crypto.randomUUID(),
    recordId: uuid(764),
    typeKey: "article",
    op: "upsert",
    input: { ...validArticleInput(), body },
    changedFields: ["body"],
    baseFieldVersions: current?.fieldVersions ?? {},
  };
  socket.send(JSON.stringify({ type: "push", changes: [pushed] }));
  const ack = (await nextMessage(socket)) as {
    type: string;
    result?: { ok: boolean; code?: string };
  };
  socket.close();
  return ack.result ?? { ok: false };
}

describe("書き込み時のリッチテキストの構造の検査(M5a-6)", () => {
  for (const [label, content] of INVALID_BODIES) {
    it(`${label} は 3 経路のどれでも validation_failed`, async () => {
      const stub = await seeded();
      expect(await viaRest(stub, bodyOf(content))).toMatchObject({
        ok: false,
        code: "validation_failed",
      });
      expect(await viaMcp(stub, bodyOf(content))).toMatchObject({
        ok: false,
        code: "validation_failed",
      });
      expect(await viaSync(stub, bodyOf(content))).toMatchObject({
        ok: false,
        code: "validation_failed",
      });
      const stored = asRecordSnapshot(await stub.getRecord(uuid(764)));
      expect(stored?.data["body"]).toMatchObject({ doc: { type: "doc", content: [] } });
    });
  }

  it("エディタが作る本文は 3 経路で通る", async () => {
    const stub = await seeded();
    expect((await viaRest(stub, EDITOR_BODY)).ok).toBe(true);
    const changed = structuredClone(EDITOR_BODY);
    (changed.doc.content[0] as { content: { text: string }[] }).content[0]!.text = "見出し 2";
    expect(await viaMcp(stub, changed)).toMatchObject({ ok: true });
    const again = structuredClone(EDITOR_BODY);
    (again.doc.content[0] as { content: { text: string }[] }).content[0]!.text = "見出し 3";
    expect(await viaSync(stub, again)).toMatchObject({ ok: true });
  });

  it("既存の不正な本文を持つ record のタイトルだけを直す保存は通る", async () => {
    const stub = await seeded();
    const invalid = bodyOf([{ type: "iframe", attrs: { src: "https://evil.example" } }]);
    // デプロイ前に書かれた値を想定して、検査を通らない本文を DO に直接置く
    const { runInDurableObject } = await import("cloudflare:test");
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE records SET data = json_set(data, '$.body', json(?)) WHERE id = ?",
        JSON.stringify(invalid),
        uuid(764),
      );
    });
    const result = asWriteResult(
      await stub.writeRecord(
        "article",
        { recordId: uuid(764), input: { ...validArticleInput(), title: "改題", body: invalid } },
        auth("a"),
      ),
    );
    expect(result.ok).toBe(true);
  });
});
