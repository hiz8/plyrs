import { createExecutionContext, createMessageBatch, getQueueResult } from "cloudflare:test";
import { env } from "cloudflare:workers";
import type { ContentTypeDefinition } from "@plyrs/metamodel";
import worker from "../src/index";
import type { ProjectionJob } from "../src/projection/jobs";
import type { TenantDO } from "../src/tenant-do";
import { auth, uuid } from "./fixtures";
import { asPublishResult, asWriteResult } from "./rpc-unwrap";

export async function seedTenant(tenantId: string, slug: string): Promise<void> {
  await env.DB.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(tenantId, slug, `tenant ${slug}`, "2026-07-14T00:00:00.000Z")
    .run();
}

export function freshTenantSlug(): string {
  return `pub-${crypto.randomUUID().slice(0, 12)}`;
}

// 実 consumer コードへ決定的に配達する。実ブローカ経由の自動配達と重複しても冪等なので無害。
// SELF.queue() は DataCloneError で壊れているため必ずこの経路を使う（既知事実）。
export async function deliverJobs(jobs: ProjectionJob[]): Promise<void> {
  const batch = createMessageBatch<ProjectionJob>(
    "plyrs-projection",
    jobs.map((body, i) => ({ id: `m${i}`, timestamp: new Date(1_000 + i), attempts: 1, body })),
  );
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  await getQueueResult(batch, ctx);
}

// write + publish して、投影 upsert ジョブに必要な世代情報を返す
export async function writeAndPublish(
  stub: DurableObjectStub<TenantDO>,
  tenantId: string,
  type: string,
  recordId: string,
  input: Record<string, unknown>,
): Promise<ProjectionJob> {
  const written = asWriteResult(await stub.writeRecord(type, { recordId, input }, auth("owner1")));
  if (!written.ok) {
    throw new Error(`writeRecord failed: ${JSON.stringify(written)}`);
  }
  const published = asPublishResult(
    await stub.publishRecord(tenantId, tenantId, recordId, auth("owner1")),
  );
  if (!published.ok) {
    throw new Error(`publishRecord failed: ${JSON.stringify(published)}`);
  }
  return {
    jobType: "upsert",
    tenantId,
    recordId,
    sourceVersion: published.snapshot.sourceVersion,
    publishSeq: published.snapshot.publishSeq,
  };
}

export function authorType(): ContentTypeDefinition {
  return {
    id: uuid(400),
    key: "author",
    name: "著者",
    source: "user",
    version: 1,
    fields: [
      { key: "name", type: "text", required: true },
      { key: "slug", type: "text", config: { unique: true, indexed: true } },
    ],
  };
}

export function postType(): ContentTypeDefinition {
  return {
    id: uuid(401),
    key: "post",
    name: "投稿",
    source: "user",
    version: 1,
    fields: [
      { key: "title", type: "text", required: true },
      { key: "slug", type: "text", required: true, config: { unique: true, indexed: true } },
      { key: "rating", type: "number", config: { indexed: true } },
      { key: "featured", type: "boolean", config: { indexed: true } },
      { key: "event_at", type: "datetime", config: { indexed: true } },
      {
        key: "category",
        type: "select",
        config: {
          options: [
            { value: "tech", label: "Tech" },
            { value: "life", label: "Life" },
          ],
          indexed: true,
        },
      },
      {
        key: "tags",
        type: "select",
        config: {
          options: [
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
            { value: "z", label: "Z" },
          ],
          multiple: true,
          indexed: true,
        },
      },
      {
        key: "authors",
        type: "relation",
        config: { allowedTypes: ["author"], cardinality: "many", ordered: true },
      },
    ],
  };
}
