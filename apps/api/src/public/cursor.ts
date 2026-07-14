// 裁定（2026-07-14）: keyset カーソル。(ソートキー値, record_id) を JSON→base64url した
// 無署名の不透明トークン。tenant / type / フィルタ条件はトークンに含めず毎回リクエストから
// 束縛するため、改ざんしても他テナントのデータには構造的に到達できない（署名を持たない根拠）。
// デコード不能・型不整合は呼び出し側（query.ts）が 400 にする。

export interface CursorPayload {
  k: string | number | null; // ソートキー値（published_at 文字列 / projection_index の索引値）
  id: string; // record_id タイブレーク
}

const MAX_TOKEN_LENGTH = 512;

export function encodeCursor(payload: CursorPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCursor(token: string): CursorPayload | null {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const candidate = parsed as { k?: unknown; id?: unknown };
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }
  const k = candidate.k ?? null;
  if (k !== null && typeof k !== "string" && typeof k !== "number") {
    return null;
  }
  return { k, id: candidate.id };
}
