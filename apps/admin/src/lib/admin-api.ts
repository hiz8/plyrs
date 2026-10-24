import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { apiErrorFromBody, throwApiError } from "./api-client";
import { NetworkError, withNetworkErrors } from "./network-error";
import type { Role } from "./permissions";
import type { TokenManager } from "./token-manager";

// Bearer 付きの管理 API(/v1/t/:tenantId/...)。トークンは token-manager が供給する。
// 形は apps/api の ContentTypeRow(rpc-unwrap.ts)と一致させる。
export interface ContentTypeSummary {
  id: string;
  key: string;
  name: string;
  fields: FieldDefinition[];
  source: "user" | "plugin" | "system";
  pluginId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  description: string | null;
  titleField: string | null;
  listColumns: string[] | null;
  menuOrder: number | null;
}

// apps/api/src/do/publish.ts の PublicationState と構造一致(HTTP 契約)
export type PublicationState =
  | { published: false }
  | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number };

// apps/api/src/do/publish.ts の PublicationSummary と構造一致(HTTP 契約。案 D 9 章)
export interface PublicationSummary {
  recordId: string;
  publishedAt: string;
  sourceVersion: number;
}

// apps/api/src/do/asset-usage.ts の AssetUsageRow と構造一致(HTTP 契約)
export interface AssetUsageEntry {
  sourceId: string;
  sourceType: string | null;
  sourceField: string;
  origin: string;
}

// apps/api の ModuleSummary と構造一致(HTTP 契約)
export interface ModuleSummary {
  moduleId: string;
  name: string;
  // 案 G 5 章の説明文と、案 A 3.2 のサイドバーに出す型の key
  description: string | null;
  navTypes: string[];
  version: number;
  enabled: boolean;
  appliedVersion: number;
}

// apps/api の routes/tenant-settings.ts の返す形(HTTP 契約)。role は文字列のまま受け、表示側で判定する
export interface MemberSummary {
  userId: string;
  email: string;
  role: string;
  createdAt: string;
}

const JSON_HEADERS = { "content-type": "application/json" } as const;

// F9・K6: アップロードのファイルごとの進捗。fetch は送信の進捗を取れないので XHR で送る
export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("The upload was aborted.", "AbortError");
}

export function createAdminApi(
  tokens: TokenManager,
  baseFetch: typeof fetch = (...args) => fetch(...args),
  { createXhr = () => new XMLHttpRequest() }: { createXhr?: () => XMLHttpRequest } = {},
) {
  const fetchImpl = withNetworkErrors(baseFetch);
  async function authedFetch(tenantId: string, path: string, init: RequestInit): Promise<Response> {
    const request = async (token: string) =>
      fetchImpl(`/v1/t/${tenantId}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
    const response = await request(await tokens.getToken(tenantId));
    if (response.status !== 401) {
      return response;
    }
    // マージン内でもサーバー側で失効していることがある(§11 申し送り)。1 回だけ再発行して再試行。
    return request(await tokens.getToken(tenantId, { forceRefresh: true }));
  }

  function sendUpload(
    tenantId: string,
    file: File,
    token: string,
    { onProgress, signal }: UploadOptions,
  ): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(abortError());
        return;
      }
      const xhr = createXhr();
      const abort = () => xhr.abort();
      const settle = () => signal?.removeEventListener("abort", abort);
      xhr.open("POST", `/v1/t/${tenantId}/assets?filename=${encodeURIComponent(file.name)}`);
      xhr.setRequestHeader("authorization", `Bearer ${token}`);
      xhr.setRequestHeader(
        "content-type",
        file.type === "" ? "application/octet-stream" : file.type,
      );
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          onProgress?.({ loaded: event.loaded, total: event.total });
        }
      });
      xhr.addEventListener("load", () => {
        settle();
        resolve({ status: xhr.status, text: xhr.responseText });
      });
      // withNetworkErrors と同じ型に揃える(errorMessage が接続エラーをこの型で判定する)
      xhr.addEventListener("error", () => {
        settle();
        reject(new NetworkError(new TypeError("Network request failed")));
      });
      xhr.addEventListener("abort", () => {
        settle();
        reject(abortError());
      });
      signal?.addEventListener("abort", abort, { once: true });
      xhr.send(file);
    });
  }

  async function requestJson<T>(
    tenantId: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await authedFetch(tenantId, path, init);
    if (!response.ok) {
      return throwApiError(response);
    }
    return (await response.json()) as T;
  }

  return {
    async listContentTypes(tenantId: string): Promise<ContentTypeSummary[]> {
      const { contentTypes } = await requestJson<{ contentTypes: ContentTypeSummary[] }>(
        tenantId,
        "/content-types",
      );
      return contentTypes;
    },
    async putContentType(
      tenantId: string,
      definition: ContentTypeDefinition,
    ): Promise<ContentTypeSummary> {
      const result = await requestJson<{ ok: true; contentType: ContentTypeSummary }>(
        tenantId,
        "/content-types",
        { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(definition) },
      );
      return result.contentType;
    },
    // 案 E 5.4: コンテンツが 0 件の型だけ削除できる(1 件以上は ApiError の type_not_empty)
    async deleteContentType(tenantId: string, key: string): Promise<void> {
      await requestJson<{ ok: true; key: string }>(
        tenantId,
        `/content-types/${encodeURIComponent(key)}`,
        { method: "DELETE" },
      );
    },
    async publishRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}/publish`, {
        method: "POST",
      });
    },
    async unpublishRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}/unpublish`, {
        method: "POST",
      });
    },
    getPublication(tenantId: string, recordId: string): Promise<PublicationState> {
      return requestJson<PublicationState>(tenantId, `/records/${recordId}/publication`);
    },
    // type を省略すると全型分(ホームの集計用)。一覧のタブ件数は全件が要るため、
    // record_id カーソルのページを最後まで辿って連結する
    async listPublications(tenantId: string, type?: string): Promise<PublicationSummary[]> {
      const all: PublicationSummary[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams();
        if (type !== undefined) params.set("type", type);
        if (cursor !== null) params.set("cursor", cursor);
        const query = params.size === 0 ? "" : `?${params.toString()}`;
        const page = await requestJson<{
          publications: PublicationSummary[];
          nextCursor: string | null;
        }>(tenantId, `/publications${query}`);
        all.push(...page.publications);
        cursor = page.nextCursor;
      } while (cursor !== null);
      return all;
    },
    // 401 は authedFetch と同じく 1 回だけ再発行して、新しい XHR で送り直す
    async uploadAsset(
      tenantId: string,
      file: File,
      options: UploadOptions = {},
    ): Promise<{ id: string }> {
      let response = await sendUpload(tenantId, file, await tokens.getToken(tenantId), options);
      if (response.status === 401) {
        const token = await tokens.getToken(tenantId, { forceRefresh: true });
        response = await sendUpload(tenantId, file, token, options);
      }
      if (response.status < 200 || response.status >= 300) {
        throw apiErrorFromBody(response.status, response.text);
      }
      const result = JSON.parse(response.text) as { ok: true; record: { id: string } };
      return { id: result.record.id };
    },
    async fetchAssetBlob(tenantId: string, assetId: string): Promise<Blob> {
      const response = await authedFetch(tenantId, `/assets/${assetId}/file`, {});
      if (!response.ok) {
        return throwApiError(response);
      }
      return response.blob();
    },
    async listOrphanAssetIds(tenantId: string): Promise<string[]> {
      const { orphanIds } = await requestJson<{ orphanIds: string[] }>(tenantId, "/assets/orphans");
      return orphanIds;
    },
    async getAssetUsage(tenantId: string, assetId: string): Promise<AssetUsageEntry[]> {
      const { usage } = await requestJson<{ usage: AssetUsageEntry[] }>(
        tenantId,
        `/assets/${assetId}/usage`,
      );
      return usage;
    },
    async deleteRecord(tenantId: string, recordId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/records/${recordId}`, { method: "DELETE" });
    },
    async listModules(tenantId: string): Promise<ModuleSummary[]> {
      const { modules } = await requestJson<{ modules: ModuleSummary[] }>(tenantId, "/modules");
      return modules;
    },
    async setModuleEnabled(
      tenantId: string,
      moduleId: string,
      enabled: boolean,
    ): Promise<ModuleSummary> {
      const { module } = await requestJson<{ ok: true; module: ModuleSummary }>(
        tenantId,
        `/modules/${moduleId}/${enabled ? "enable" : "disable"}`,
        { method: "POST" },
      );
      return module;
    },
    // 案 G 3・4 章: サイト名の変更とメンバーの管理(owner のみ)
    async renameSite(tenantId: string, name: string): Promise<string> {
      const result = await requestJson<{ ok: true; name: string }>(tenantId, "/site", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name }),
      });
      return result.name;
    },
    async listMembers(tenantId: string): Promise<MemberSummary[]> {
      const { members } = await requestJson<{ members: MemberSummary[] }>(tenantId, "/members");
      return members;
    },
    async addMember(tenantId: string, email: string, role: Role): Promise<MemberSummary> {
      const { member } = await requestJson<{ member: MemberSummary }>(tenantId, "/members", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email, role }),
      });
      return member;
    },
    async changeMemberRole(tenantId: string, userId: string, role: Role): Promise<MemberSummary> {
      const { member } = await requestJson<{ member: MemberSummary }>(
        tenantId,
        `/members/${userId}`,
        { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ role }) },
      );
      return member;
    },
    async removeMember(tenantId: string, userId: string): Promise<void> {
      await requestJson<{ ok: true }>(tenantId, `/members/${userId}`, { method: "DELETE" });
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
