import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { html } from "hono/html";
import { allowedScopes, type PatScope } from "../auth/pat";
import type { Role } from "../auth/permissions";

// design-spec 16.3(論点 C3・C5、M3-2): 同意画面の純関数部分。選択肢はロールごとの allowedScopes(PAT の
// 発行と同じ規則)に限り、record:publish は要求されていても既定で外す(所有者にしか出ない)。
// クライアント由来の文字列(clientName / clientDomain / redirectHost / scope)はすべて html`` の補間で
// エスケープする(raw() は使わない)。ライブラリの文書 consent-page.md に従い、client 名・スコープ・
// 送り先のホスト・loopback の警告・CIMD のドメインを出す。

export interface ConsentScope {
  value: PatScope;
  checked: boolean;
}

export function consentScopes(role: Role, requested: readonly string[]): ConsentScope[] {
  return allowedScopes(role).map((value) => ({
    value,
    checked: value !== "record:publish" && requested.includes(value),
  }));
}

// 管理画面の TOKEN_LABELS.scopes / scopeDescriptions と同じ文(api は admin を import できないので写す)
const SCOPE_LABELS: Record<PatScope, { label: string; description: string }> = {
  "record:read": {
    label: "読み取り(record:read)",
    description: "コンテンツタイプとコンテンツを読み取ります。下書きも含みます",
  },
  "record:write": {
    label: "作成・編集(record:write)",
    description: "コンテンツを作成・編集します",
  },
  "record:delete": { label: "削除(record:delete)", description: "コンテンツを削除します" },
  "record:publish": {
    label: "公開(record:publish)",
    description:
      "コンテンツを公開します。既定では外れています。人が公開する運用のままにするなら付けないでください",
  },
  "type:manage": {
    label: "コンテンツタイプの変更(type:manage)",
    description: "コンテンツタイプの定義を変更します",
  },
};

const STYLE = `
  body { margin: 0; font-family: system-ui, sans-serif; background: #f4f4f5; color: #18181b; }
  main { max-width: 440px; margin: 48px auto; padding: 24px; background: #fff; border: 1px solid #e4e4e7; border-radius: 8px; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  p { margin: 8px 0; font-size: 14px; line-height: 1.6; }
  .muted { color: #52525b; font-size: 13px; }
  .warn { padding: 8px 12px; background: #fef3c7; border-radius: 6px; }
  fieldset { border: 0; padding: 0; margin: 16px 0; }
  legend { font-weight: 600; font-size: 14px; margin-bottom: 8px; }
  label { display: block; padding: 8px 0; border-top: 1px solid #e4e4e7; font-size: 14px; }
  label span { display: block; color: #52525b; font-size: 12px; margin-left: 22px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
  button { padding: 8px 16px; border-radius: 6px; border: 1px solid #d4d4d8; background: #fff; font-size: 14px; cursor: pointer; }
  button.primary { background: #18181b; color: #fff; border-color: #18181b; }
`;

function layout(title: string, body: ReturnType<typeof html>): string {
  return html`<!doctype html>
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          ${STYLE}
        </style>
      </head>
      <body>
        <main>${body}</main>
      </body>
    </html>`.toString();
}

export interface ConsentPageInput {
  details: ConsentDescription;
  handle: string;
  scopes: readonly ConsentScope[];
  tenantName: string;
  email: string;
}

export function renderConsentPage(input: ConsentPageInput): string {
  const { details } = input;
  const origin =
    details.clientDomain === undefined
      ? html`<p class="muted">このアプリは自己登録したもので、名前は検証されていません。</p>`
      : html`<p class="muted">発行元: <strong>${details.clientDomain}</strong></p>`;
  const loopback = details.redirectIsLoopback
    ? html`<p class="warn">
        接続先はこのパソコン上のアプリです。いま自分で接続を始めた場合だけ続けてください。
      </p>`
    : "";
  const scopes = input.scopes.map(
    (scope) =>
      html`<label>
        <input
          type="checkbox"
          name="scope"
          value="${scope.value}"
          ${scope.checked ? "checked" : ""}
        />
        ${SCOPE_LABELS[scope.value].label}
        <span>${SCOPE_LABELS[scope.value].description}</span>
      </label>`,
  );
  return layout(
    "接続の許可",
    html`<h1>${details.clientName} がサイト「${input.tenantName}」への接続を求めています</h1>
      ${origin}
      <p>ログイン中: ${input.email}</p>
      <p>許可すると、接続の結果は <strong>${details.redirectHost}</strong> に送られます。</p>
      ${loopback}
      <form method="post">
        <input type="hidden" name="handle" value="${input.handle}" />
        <fieldset>
          <legend>許可する操作</legend>
          <p class="muted">
            実際にできる操作は、ここで選んだ範囲とあなたのロールの両方で許されたものに限られます
          </p>
          ${scopes}
        </fieldset>
        <div class="actions">
          <button type="submit" name="decision" value="deny">許可しない</button>
          <button type="submit" name="decision" value="approve" class="primary">許可する</button>
        </div>
      </form>`,
  );
}

export function renderErrorPage(title: string, message: string): string {
  return layout(
    title,
    html`<h1>${title}</h1>
      <p>${message}</p>`,
  );
}
