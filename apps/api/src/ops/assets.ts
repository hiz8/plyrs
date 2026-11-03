import { z } from "zod";
import { AGENT_ASSET_CONTENT_TYPES, MAX_ASSET_FILENAME_LENGTH } from "../assets/store";
import { defineOperation, type OpSpec } from "./spec";

// design-spec 16.11(M4-4 / M4-5): エージェント経路のアセット登録。どちらも Worker で実行する
// (runsIn: "worker"。実装は mcp/worker-ops.ts)。作った asset は record_create / record_update の本文で
// ![label](plyrs://asset/<assetId>) として参照する。

export const ASSET_UPLOAD_TTL_SECONDS = 600;

export const assetUpload = defineOperation({
  name: "asset_upload",
  title: "アセットのアップロード先を発行",
  description:
    "画像を 1 つアップロードするための URL を発行する。返った uploadUrl に画像の本文をそのまま POST する(10 分以内、1 回だけ、20 MiB まで。Authorization は不要。Content-Type は発行時の contentType が使われる)。POST の応答の assetId を本文で ![label](plyrs://asset/<assetId>) として使う。受けるのは PNG / JPEG / GIF / WebP / AVIF。",
  input: z.object({
    filename: z.string().min(1).max(MAX_ASSET_FILENAME_LENGTH).describe("ファイル名(例: hero.png)"),
    contentType: z.enum(AGENT_ASSET_CONTENT_TYPES).describe("画像の MIME タイプ"),
  }),
  output: z.object({
    uploadUrl: z.string(),
    expiresAt: z.string(),
    maxBytes: z.number().int(),
  }),
  requires: "record:write",
  via: ["mcp"],
  hints: { readOnly: false, destructive: false, idempotent: false, openWorld: false },
  cache: null,
  runsIn: "worker",
});

export const assetImportUrl = defineOperation({
  name: "asset_import_url",
  title: "URL から画像を取り込む",
  description:
    "公開されている画像の URL を取りに行き、アセットとして登録する。返った assetId を本文で ![label](plyrs://asset/<assetId>) として使う。https の URL のみ(既定のポート、IP アドレスや localhost は不可)、リダイレクトは 3 回まで、20 MiB まで、PNG / JPEG / GIF / WebP / AVIF のみ。手元のファイルは asset_upload を使う。",
  input: z.object({
    url: z.url().describe("画像の https URL"),
    filename: z
      .string()
      .min(1)
      .max(MAX_ASSET_FILENAME_LENGTH)
      .optional()
      .describe("保存するファイル名。省略すると URL の最後のパス要素"),
  }),
  output: z.object({
    assetId: z.string(),
    contentType: z.string(),
    size: z.number().int(),
  }),
  requires: "record:write",
  via: ["mcp"],
  // 外部の URL を取りに行く(MCP の openWorldHint)
  hints: { readOnly: false, destructive: false, idempotent: false, openWorld: true },
  cache: null,
  runsIn: "worker",
});

export const ASSET_OPERATIONS: readonly OpSpec[] = [assetUpload, assetImportUrl];
