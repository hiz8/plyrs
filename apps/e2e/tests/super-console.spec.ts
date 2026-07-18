import { expect, test } from "@playwright/test";
import { persistSuperAdminSecret, SUPER_EMAIL, SUPER_PASSWORD } from "../helpers/setup";
import { totpCode } from "../helpers/totp";

// このプロセス全体で bootstrap を成立させる唯一の spec(2 回目の bootstrap 呼び出しは
// 403 already_bootstrapped)。playwright.config.ts の projects/dependencies で必ず
// 最初に実行される。ラベル・ロール名は apps/admin/src/super-login.test.tsx /
// super-tenants.test.tsx / super-ops.test.tsx を真実源にしている。
test("bootstrap, totp login, tenant CRUD and audit log", async ({ page }) => {
  await page.goto("/super-login");
  await expect(page.getByRole("heading", { name: "初期セットアップ" })).toBeVisible();

  await page.getByLabel("メールアドレス").fill(SUPER_EMAIL);
  await page.getByLabel("パスワード").fill(SUPER_PASSWORD);
  await page.getByRole("button", { name: "登録" }).click();

  // totp secret は super-login.tsx の data-testid="totp-secret"(表示ロジックは変更していない)。
  const secret = await page.getByTestId("totp-secret").innerText();
  expect(secret.length).toBeGreaterThan(0);
  persistSuperAdminSecret(secret);

  await expect(page.getByRole("heading", { name: "運営コンソールへログイン" })).toBeVisible();
  await page.getByLabel("認証コード").fill(totpCode(secret));
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/super$/);

  // テナント作成
  await page.getByLabel("テナント名").fill("Smoke Tenant");
  await page.getByLabel("slug").fill("smoke");
  await page.getByRole("button", { name: "作成" }).click();
  // "smoke"(部分一致)は "Smoke Tenant" 列とも衝突するため exact で slug 列だけに絞る。
  await expect(page.getByRole("cell", { name: "smoke", exact: true })).toBeVisible();

  // 監査ログ
  await page.getByRole("link", { name: "監査ログ" }).click();
  await expect(page.getByRole("cell", { name: "tenant.create" })).toBeVisible();
});
