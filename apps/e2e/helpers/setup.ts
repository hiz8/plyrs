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
  // 所属 1 件ならサイト選択を飛ばしてホームに着地する(型の有無で転送しない)。URL だけを待つ。
  await page.waitForURL(/\/t\/[^/]+(\/|$)/);
}

/** ログイン直後のサイトでサイドバーの「設定」から入り、タブ「コンテンツタイプ」を開いて article 型(title text field)を作る。設定はまず「一般」に着地する(V4-G、裁定 G4)ためタブを押す。 */
export async function createArticleType(page: Page): Promise<void> {
  // パンくずにも「設定」リンクがあるため、サイドバー(<aside> = complementary)に限定する。
  await page.getByRole("complementary").getByRole("link", { name: "設定", exact: true }).click();
  await page.getByRole("tab", { name: "コンテンツタイプ" }).click();
  await expect(page.getByRole("tab", { name: "コンテンツタイプ" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("button", { name: "コンテンツタイプを作成" }).click();
  await page.getByRole("textbox", { name: /^表示名/ }).fill("記事");
  // 表示名が日本語だと API 名は自動導出できないので手入力する。
  await page.getByRole("textbox", { name: /^API 名/ }).fill("article");
  await page.getByRole("button", { name: "フィールドを追加" }).click();
  const dialog = page.getByRole("dialog", { name: "フィールドを追加" });
  await dialog.getByRole("button", { name: /テキスト\(1 行\)/ }).click();
  await dialog.getByRole("button", { name: "次へ" }).click();
  // フィールドの API 名は表示名「title」から自動で title になる。
  await dialog.getByRole("textbox", { name: /^表示名/ }).fill("title");
  await dialog.getByRole("button", { name: "追加" }).click();
  await page.getByRole("dialog", { name: "title" }).getByRole("button", { name: "適用" }).click();
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await expect(page.getByRole("tab", { name: "コンテンツタイプ" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

/** コンテンツタイプ一覧から article の編集画面を開いて 1 件下書き保存し、一覧へ戻る。 */
export async function createArticleRecord(page: Page, title: string): Promise<void> {
  // 一覧の行にレコードへのリンクは無い。サイドバー(complementary)の型名のリンクから入る。
  await page.getByRole("complementary").getByRole("link", { name: "記事", exact: true }).click();
  // 一覧が 0 件のときは空状態にも「記事を追加」があるため、見出しの右(先頭)のボタンに絞る(V3 の案 D 空状態)。
  await page.getByRole("button", { name: "記事を追加" }).first().click();
  await page.getByRole("textbox", { name: "title" }).fill(title);
  // 下部固定バーにも同名のボタンがあるため、公開ボックス(region「公開」)に絞る。
  await page
    .getByRole("region", { name: "公開", exact: true })
    .getByRole("button", { name: "下書き保存" })
    .click();
  // 作成後は編集画面(/content/article/<id>)に留まる。サイドバーの「一覧」で一覧へ戻る。
  await page.waitForURL(/\/content\/article\/[0-9a-f-]{36}$/);
  await page.getByRole("complementary").getByRole("link", { name: "一覧", exact: true }).click();
  await expect(page.getByRole("rowheader", { name: title })).toBeVisible();
}

/** レコード一覧から title のレコードを開き、エディタページの URL を返す。 */
export async function openRecordEditor(page: Page, title: string): Promise<string> {
  // 行には「編集」リンクもあるので、名前がタイトルのリンクに限定する。
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("region", { name: "公開", exact: true })).toBeVisible();
  return page.url();
}

export async function publishRecord(page: Page): Promise<void> {
  const box = page.getByRole("region", { name: "公開", exact: true });
  await box.getByRole("button", { name: "公開", exact: true }).click();
  await expect(box.getByText("公開中", { exact: true })).toBeVisible();
}
