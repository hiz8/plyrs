import { DurableObject } from "cloudflare:workers";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import * as schema from "@plyrs/db";
import migrations from "@plyrs/db/migrations";
import { contentTypeDefinitionSchema } from "@plyrs/metamodel";
import {
  loadContentTypeByKey,
  registerContentTypeCore,
  type ContentTypeRow,
  type RegisterContentTypeResult,
} from "./do/content-types";

export class TenantDO extends DurableObject<Env> {
  private readonly db: DrizzleSqliteDODatabase<typeof schema>;
  // DO 全体の単調 seq（G2）。single-writer なのでメモリ保持 + 起動時復元で十分
  private seq = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
      const row = ctx.storage.sql
        .exec<{ max_seq: number | null }>("SELECT MAX(seq) AS max_seq FROM records")
        .one();
      this.seq = row.max_seq ?? 0;
    });
  }

  ping(): string {
    return "pong";
  }

  // モノレポの .ts 直接 exports が workerd バンドルを通ることの早期検証を兼ねる
  validateContentTypeInput(input: unknown): { valid: boolean } {
    return { valid: contentTypeDefinitionSchema.safeParse(input).success };
  }

  registerContentType(input: unknown): RegisterContentTypeResult {
    const now = new Date().toISOString();
    return this.ctx.storage.transactionSync(() =>
      registerContentTypeCore(this.ctx.storage.sql, input, now),
    );
  }

  getContentType(key: string): ContentTypeRow | null {
    return loadContentTypeByKey(this.ctx.storage.sql, key);
  }
}
