import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { AuthContext } from "../src/do/authorize";
import { loadHistory, loadVersion, type HistoryEntry } from "../src/do/history";
import { articleType, auth, uuid, validArticleInput } from "./fixtures";
import {
  asDeleteResult,
  asPublishResult,
  asRegisterResult,
  asUnpublishResult,
  asWriteResult,
} from "./rpc-unwrap";

const TENANT = "tenant-history-publish";
const OWNER: AuthContext = { userId: "u-owner", role: "owner" };

function freshStub() {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(crypto.randomUUID()));
}

async function historyOf(
  stub: ReturnType<typeof freshStub>,
  recordId: string,
): Promise<HistoryEntry[]> {
  return runInDurableObject(
    stub,
    (_instance, state) => loadHistory(state.storage.sql, recordId, { limit: 50 }).items,
  );
}

async function setupArticle() {
  const stub = freshStub();
  expect((await stub.registerContentType(articleType(), auth("owner1"))).ok).toBe(true);
  const written = asWriteResult(
    await stub.writeRecord(
      "article",
      { recordId: uuid(100), input: validArticleInput() },
      auth("owner1"),
    ),
  );
  expect(written.ok).toBe(true);
  return stub;
}

describe("publish / unpublish / delete の履歴(16.5 / M2-3b)", () => {
  it("publish で kind: publish の版が source_version = records.version で入り、直後の write は畳まれない", async () => {
    const stub = await setupArticle();
    expect(
      asPublishResult(await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"))).ok,
    ).toBe(true);
    const afterPublish = await historyOf(stub, uuid(100));
    expect(
      afterPublish.map((item) => [item.kind, item.version, item.sourceVersion, item.via]),
    ).toEqual([
      ["publish", 1, 1, "rest"],
      ["write", 1, null, "rest"],
    ]);
    // 同じ actor・via・status で続けて書いても publish の版には畳み込まれない
    expect(
      asWriteResult(
        await stub.writeRecord(
          "article",
          { recordId: uuid(100), input: { ...validArticleInput(), title: "改題" } },
          auth("owner1"),
        ),
      ).ok,
    ).toBe(true);
    const afterWrite = await historyOf(stub, uuid(100));
    expect(afterWrite.map((item) => [item.kind, item.version])).toEqual([
      ["write", 2],
      ["publish", 1],
      ["write", 1],
    ]);
    // publish 版の本文は公開時点のもの
    await runInDurableObject(stub, (_instance, state) => {
      expect(loadVersion(state.storage.sql, uuid(100), 2)?.data["title"]).toBe(
        validArticleInput()["title"],
      );
    });
  });

  it("unpublish で kind: unpublish の版が入る", async () => {
    const stub = await setupArticle();
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    expect(
      asUnpublishResult(await stub.unpublishRecord(TENANT, uuid(100), auth("owner2"))).ok,
    ).toBe(true);
    const items = await historyOf(stub, uuid(100));
    expect(items[0]).toMatchObject({
      kind: "unpublish",
      sourceVersion: 1,
      actor: "owner2",
      via: "rest",
    });
  });

  it("delete で kind: delete の版に削除前の data が残り、公開済みでもカスケード unpublish は記録しない", async () => {
    const stub = await setupArticle();
    await stub.publishRecord(TENANT, TENANT, uuid(100), auth("owner1"));
    expect(asDeleteResult(await stub.deleteRecord(uuid(100), auth("owner1"))).ok).toBe(true);
    const items = await historyOf(stub, uuid(100));
    expect(items.map((item) => item.kind)).toEqual(["delete", "publish", "write"]);
    await runInDurableObject(stub, (_instance, state) => {
      const deleted = loadVersion(state.storage.sql, uuid(100), 3);
      expect(deleted?.data["title"]).toBe(validArticleInput()["title"]);
      expect(deleted?.version).toBe(2); // delete は records.version を進める
    });
  });

  it("カスケードで publish された asset にも publish の版が入る", async () => {
    const stub = freshStub();
    const mediaArticleType = {
      id: "018f2b6a-7a0a-7000-8000-00000000c002",
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
      ],
    };
    expect(asRegisterResult(await stub.registerContentType(mediaArticleType, OWNER)).ok).toBe(true);
    const assetId = uuidv7();
    expect(
      asWriteResult(
        await stub.createAssetRecord(
          {
            recordId: assetId,
            input: {
              filename: "hero.png",
              content_type: "image/png",
              size: 100,
              r2_key: `${TENANT}/${assetId}`,
            },
          },
          OWNER,
        ),
      ).ok,
    ).toBe(true);
    const articleId = uuidv7();
    expect(
      asWriteResult(
        await stub.writeRecord(
          "media_article",
          { recordId: articleId, input: { title: "記事", hero: { type: "asset", id: assetId } } },
          OWNER,
        ),
      ).ok,
    ).toBe(true);
    expect(asPublishResult(await stub.publishRecord(TENANT, TENANT, articleId, OWNER)).ok).toBe(
      true,
    );
    const assetHistory = await historyOf(stub, assetId);
    expect(assetHistory.map((item) => item.kind)).toEqual(["publish", "write"]);
    expect(assetHistory[0]).toMatchObject({ actor: "u-owner", via: "rest", sourceVersion: 1 });
  });
});
