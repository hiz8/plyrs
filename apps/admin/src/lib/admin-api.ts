import type { FieldDefinition } from "@plyrs/metamodel";
import { throwApiError } from "./api-client";
import type { TokenManager } from "./token-manager";

// Bearer 付きの管理 API（/v1/t/:tenantId/...）。トークンは token-manager が供給する。
// 形は apps/api の ContentTypeRow（rpc-unwrap.ts）と一致させる。
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

export function createAdminApi(
  tokens: TokenManager,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
) {
  async function requestJson<T>(tenantId: string, path: string): Promise<T> {
    const token = await tokens.getToken(tenantId);
    const response = await fetchImpl(`/v1/t/${tenantId}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
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
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
