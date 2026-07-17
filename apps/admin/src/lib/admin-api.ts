import type { ContentTypeDefinition, FieldDefinition } from "@plyrs/metamodel";
import { throwApiError } from "./api-client";
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
}

// apps/api/src/do/publish.ts の PublicationState と構造一致(HTTP 契約)
export type PublicationState =
  | { published: false }
  | { published: true; publishedAt: string; publishedBy: string; sourceVersion: number };

const JSON_HEADERS = { "content-type": "application/json" } as const;

export function createAdminApi(
  tokens: TokenManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
) {
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
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
