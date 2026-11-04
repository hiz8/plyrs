import { generateSessionToken, sha256Hex } from "../auth/session";
import { fetchPublicImage } from "../assets/fetch-url";
import { MAX_ASSET_SIZE_BYTES, storeAsset } from "../assets/store";
import { requireOperation } from "../do/authorize";
import { ASSET_UPLOAD_TTL_SECONDS } from "../ops/assets";
import type { OpSpec } from "../ops/catalog";
import { missingScope, type InvokeResult } from "../ops/invoke";
import { asCreateAssetUploadResult } from "../rpc-unwrap";
import type { McpServerDeps } from "./server";

// design-spec 16.4 / 16.11(M4-4): Worker で実行する操作(runsIn: "worker")。判定の順序は DO の invoke
// (ops/invoke.ts の runOperation)と同じ: スコープ → ロール → 入力の parse → 実装。

type WorkerHandler = (deps: McpServerDeps, input: never) => Promise<InvokeResult>;

export function uploadUrlOf(origin: string, tenantId: string, token: string): string {
  return `${origin}/mcp/t/${tenantId}/uploads/${token}`;
}

// 32 バイトの乱数(base64url)。DO には SHA-256 だけを置く
async function assetUpload(
  deps: McpServerDeps,
  input: { filename: string; contentType: string },
): Promise<InvokeResult> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + ASSET_UPLOAD_TTL_SECONDS * 1000).toISOString();
  const stub = deps.env.TENANT_DO.get(deps.env.TENANT_DO.idFromName(deps.tenantId));
  const created = asCreateAssetUploadResult(
    await stub.createAssetUpload(
      {
        tokenHash: await sha256Hex(token),
        filename: input.filename,
        contentType: input.contentType,
        expiresAt,
      },
      deps.auth,
    ),
  );
  if (!created.ok) {
    return created;
  }
  return {
    ok: true,
    output: {
      uploadUrl: uploadUrlOf(deps.origin, deps.tenantId, token),
      expiresAt,
      maxBytes: MAX_ASSET_SIZE_BYTES,
    },
  };
}

// 16.11(M4-5): URL から取り込む。SSRF の規則は assets/fetch-url.ts
async function assetImportUrl(
  deps: McpServerDeps,
  input: { url: string; filename?: string },
): Promise<InvokeResult> {
  const fetched = await fetchPublicImage(input.url);
  if (!fetched.ok) {
    return fetched;
  }
  const stored = await storeAsset(deps.env, deps.tenantId, deps.auth, {
    body: fetched.body,
    filename: input.filename ?? fetched.filename,
    contentType: fetched.contentType,
  });
  if (!stored.ok) {
    return stored;
  }
  return {
    ok: true,
    output: {
      assetId: stored.record.id,
      contentType: fetched.contentType,
      size: fetched.body.byteLength,
    },
  };
}

const WORKER_HANDLERS: Readonly<Record<string, WorkerHandler>> = {
  asset_upload: assetUpload,
  asset_import_url: assetImportUrl,
};

export async function runWorkerOperation(
  deps: McpServerDeps,
  spec: OpSpec,
  input: unknown,
): Promise<InvokeResult> {
  const handler = WORKER_HANDLERS[spec.name];
  if (handler === undefined) {
    return { ok: false, code: "unknown_operation", message: `unknown operation: ${spec.name}` };
  }
  const missing = missingScope(deps.auth, spec);
  if (missing !== null) {
    return {
      ok: false,
      code: "insufficient_scope",
      message: `token scope does not include ${missing}`,
    };
  }
  const denial = requireOperation(deps.auth, spec.requires);
  if (denial !== null) {
    return denial;
  }
  const parsed = spec.input.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "invalid_input",
      message: "input does not match the operation schema",
      issues: parsed.error.issues,
    };
  }
  return handler(deps, parsed.data as never);
}
