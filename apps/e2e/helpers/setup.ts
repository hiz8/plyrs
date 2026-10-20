import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { totpCode } from "./totp";

// 3 spec(super-console → core-journey → two-tab-sync)は playwright.config.ts の
// projects/dependencies で直列に強制されるが、bootstrap は全体を通じて 1 回しか
// 成立しない(2 回目は 403 already_bootstrapped)。UI 経由の bootstrap を検証するのは
// super-console.spec.ts の役目なので、そこで得た totp secret をファイルへ永続化し、
// 後続の spec(API 経由でログインするだけ)から読み直す。
const stateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.state");
const superAdminFile = path.join(stateDir, "super-admin.json");

export const SUPER_EMAIL = "root@example.com";
export const SUPER_PASSWORD = "super-password-123";

interface SuperAdminState {
  totpSecret: string;
}

/** super-console.spec.ts が UI 経由の bootstrap 直後に呼ぶ。 */
export function persistSuperAdminSecret(totpSecret: string): void {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(superAdminFile, JSON.stringify({ totpSecret } satisfies SuperAdminState));
}

function readSuperAdminSecret(): string {
  if (!existsSync(superAdminFile)) {
    throw new Error(
      "super admin の totp secret が見つかりません。super-console.spec.ts が先に実行され " +
        "bootstrap を完了している必要があります(playwright.config.ts の projects/dependencies 参照)。",
    );
  }
  const state = JSON.parse(readFileSync(superAdminFile, "utf-8")) as SuperAdminState;
  return state.totpSecret;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** super 管理者としてログインし、session cookie を request context(≒ブラウザ)へ乗せる。 */
export async function superLogin(request: APIRequestContext): Promise<void> {
  const secret = readSuperAdminSecret();
  const res = await request.post("/super-auth/login", {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD, totpCode: totpCode(secret) },
  });
  if (res.ok()) return;
  // super-auth の totp は RFC 6238 の 30 秒窓カウンタで単調増加を要求する(リプレイ拒否:
  // counter <= totpLastCounter)。直前の spec(super-console.spec.ts の UI ログイン、あるいは
  // 同一 spec 内の前回呼び出し)が同じ 30 秒窓のコードを既に使い切っていると 401
  // invalid_credentials になる(不一致もリプレイも同じ応答で区別できない設計)。次の窓の
  // 頭まで待って 1 回だけ再試行する。
  const msIntoWindow = Date.now() % 30_000;
  await sleep(30_000 - msIntoWindow + 500);
  const retry = await request.post("/super-auth/login", {
    data: { email: SUPER_EMAIL, password: SUPER_PASSWORD, totpCode: totpCode(secret) },
  });
  if (!retry.ok()) {
    throw new Error(`super login failed: ${retry.status()} ${await retry.text()}`);
  }
}

export async function signupUser(
  request: APIRequestContext,
  input: { email: string; password: string },
): Promise<void> {
  const res = await request.post("/auth/signup", { data: input });
  if (res.status() !== 201) {
    throw new Error(`signup failed: ${res.status()} ${await res.text()}`);
  }
}

/** super セッションが request context に乗っている前提(先に superLogin を呼ぶこと)。 */
export async function provisionTenant(
  request: APIRequestContext,
  input: { name: string; slug: string; ownerEmail: string },
): Promise<void> {
  const res = await request.post("/super/v1/tenants", { data: input });
  if (res.status() !== 201) {
    throw new Error(`tenant create failed: ${res.status()} ${await res.text()}`);
  }
}

// ---- UI フロー((b) core-journey / (c) two-tab-sync 共通) ----
// ラベルは apps/admin の画面(シェルと各ページ)と RTL テスト(auth-flow /
// content-type-builder / records-flow / publish-slots)に合わせている。

export async function loginAsUser(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
  // 所属 1 件ならサイト選択を飛ばしてサイトへ着地する。着地先は型の有無で変わるので URL だけを待つ。
  await page.waitForURL(/\/t\/[^/]+\//);
}

/** ログイン直後のサイトでサイドバーの「設定」から入り、article 型(title text field)を作る。 */
export async function createArticleType(page: Page): Promise<void> {
  // パンくずにも「設定」リンクがあるため、サイドバー(<aside> = complementary)に限定する。
  await page.getByRole("complementary").getByRole("link", { name: "設定", exact: true }).click();
  await expect(page.getByRole("heading", { name: "コンテンツタイプ" })).toBeVisible();
  await page.getByRole("button", { name: "コンテンツタイプを追加" }).click();
  await page.getByRole("textbox", { name: "key" }).fill("article");
  await page.getByRole("textbox", { name: "表示名" }).fill("記事");
  await page.getByRole("button", { name: "フィールドを追加" }).click();
  await page.getByRole("textbox", { name: "フィールド key" }).fill("title");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "コンテンツタイプ" })).toBeVisible();
}

/** コンテンツタイプ一覧から article の編集画面を開いて 1 件下書き保存し、一覧へ戻る。 */
export async function createArticleRecord(page: Page, title: string): Promise<void> {
  // テナントには asset 型(システム管理)も同居しており「レコード」リンクが複数行にまたがるため、
  // article 行に絞る(article/asset は互いに部分文字列でないので row 名の正規表現で一意)。
  await page
    .getByRole("row", { name: /article/ })
    .getByRole("link", { name: "レコード" })
    .click();
  await page.getByRole("button", { name: "記事を追加" }).click();
  await page.getByRole("textbox", { name: "title" }).fill(title);
  // 下部固定バーにも同名のボタンがあるため、公開ボックス(region「公開」)に絞る。
  await page
    .getByRole("region", { name: "公開" })
    .getByRole("button", { name: "下書き保存" })
    .click();
  // 作成後は編集画面(/content/article/<id>)に留まる。サイドバーの「一覧」で一覧へ戻る。
  await page.waitForURL(/\/content\/article\/[0-9a-f-]{36}$/);
  await page.getByRole("complementary").getByRole("link", { name: "一覧", exact: true }).click();
  await expect(page.getByRole("cell", { name: title })).toBeVisible();
}

/** レコード一覧から title のレコードを開き、エディタページの URL を返す。 */
export async function openRecordEditor(page: Page, title: string): Promise<string> {
  // 行には「編集」リンクもあるので、名前がタイトルのリンクに限定する。
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("region", { name: "公開" })).toBeVisible();
  return page.url();
}

export async function publishRecord(page: Page): Promise<void> {
  const box = page.getByRole("region", { name: "公開" });
  await box.getByRole("button", { name: "公開", exact: true }).click();
  await expect(box.getByText("公開中", { exact: true })).toBeVisible();
}
