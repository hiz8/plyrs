import { v7 as uuidv7 } from "uuid";
import type { AuthContext } from "../do/authorize";
import type { WriteRecordResult } from "../do/types";
import { asWriteResult } from "../rpc-unwrap";
import { sniffImageSize } from "./image-size";

// Phase 8 決定 1 / design-spec 16.11: アセットの保存(R2 に put → DO に asset の record → 失敗したら R2 を
// 片付ける)。管理画面の POST /assets、MCP のアップロードトークン(M4-4)、URL 取り込み(M4-5)が共有する。

// CMS の画像用途に十分な上限(動画等の大容量は非目標)
export const MAX_ASSET_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_ASSET_FILENAME_LENGTH = 256;
export const MAX_ASSET_CONTENT_TYPE_LENGTH = 256; // asset 型の content_type フィールド maxLength と一致

// エージェント経路(アップロードトークン・URL 取り込み)で受ける Content-Type。SVG はスクリプトを含みうるので
// 入れない。管理画面の POST /assets は従来どおり制限しない(人が選んだファイル)
export const AGENT_ASSET_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export function isAgentAssetContentType(value: string): boolean {
  return (AGENT_ASSET_CONTENT_TYPES as readonly string[]).includes(value);
}

// 本文を読みながら上限で打ち切る(Content-Length の無い chunked でも上限を超えて溜めない)
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; body: ArrayBuffer } | { ok: false; code: "too_large" }> {
  if (body === null) {
    return { ok: true, body: new ArrayBuffer(0) };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { ok: false, code: "too_large" };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: merged.buffer };
}

export interface AssetFile {
  body: ArrayBuffer;
  filename: string;
  contentType: string;
}

export async function storeAsset(
  env: Env,
  tenantId: string,
  auth: AuthContext,
  file: AssetFile,
): Promise<WriteRecordResult> {
  // ID はサーバー生成(uuidv7)。r2_key は `${tenantId}/${assetId}` 規約 — バイナリは不変
  // (差し替えは新しい asset)。寸法はサーバー側スニファで導出(クライアント申告を信用しない)。
  const assetId = uuidv7();
  const r2Key = `${tenantId}/${assetId}`;
  const dimensions = sniffImageSize(new Uint8Array(file.body));
  await env.ASSETS.put(r2Key, file.body);
  const stub = env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
  const result = asWriteResult(
    await stub.createAssetRecord(
      {
        recordId: assetId,
        input: {
          filename: file.filename,
          content_type: file.contentType.slice(0, MAX_ASSET_CONTENT_TYPE_LENGTH),
          size: file.body.byteLength,
          r2_key: r2Key,
          ...(dimensions === null ? {} : { width: dimensions.width, height: dimensions.height }),
        },
      },
      auth,
    ),
  );
  if (!result.ok) {
    // メタデータ作成に失敗したバイナリは孤児になるため片付ける(best-effort —
    // 失敗した孤児は Phase 10 の R2 GC 候補)。
    try {
      await env.ASSETS.delete(r2Key);
    } catch {
      console.error("orphan R2 object left behind", r2Key);
    }
  }
  return result;
}
