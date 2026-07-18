import { expect, test } from "@playwright/test";
import {
  createArticleRecord,
  createArticleType,
  loginAsUser,
  openRecordEditor,
  provisionTenant,
  signupUser,
  superLogin,
} from "../helpers/setup";

// playwright.config.ts の projects/dependencies により super-console → core-journey の後に
// 実行される(super 管理者の bootstrap を前提にできる)。準備手順は core-journey.spec.ts と
// 同じ helpers/setup.ts を使うが、テナントは別(journey と衝突しない sync-tenant)。
//
// 実装時の検証で判明した点(self-review に詳細記載): apps/admin の record エディタ
// (components/record-form.tsx)は §12 必須②の dirty-only 保存のため、フィールドの
// defaultValues をマウント時の 1 回だけ束縛する — 他クライアントの保存が WS 経由で
// 同じ record を更新しても、開いたままの入力欄の表示値は自動では変わらない(未保存の
// 自分の入力を他者の変更で消さないための意図的な設計に見える)。そのため「値が現れる」
// 確認は、record-form の内部 draft を経由せず useCollectionRows を直接描画する一覧ページ
// (/t/$tenantSlug/records/$typeKey)で行う — こちらは reload なしで WS push を反映する。
// 編集・保存の操作自体は brief どおり編集画面で行う。
test("two tabs stay in sync over the WS push channel", async ({ page, context }) => {
  const email = `user+${Date.now()}@example.com`;
  const password = "user-password-123";

  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, {
    name: "Sync Tenant",
    slug: "sync-tenant",
    ownerEmail: email,
  });

  await loginAsUser(page, email, password);
  await createArticleType(page, "Sync Tenant");
  const initialTitle = "初期値の記事";
  await createArticleRecord(page, initialTitle);
  const listUrl = page.url();

  // 同一 context(cookie 共有)で 2 つ目のタブを開き、同じ record 一覧を表示する。
  const pageB = await context.newPage();
  await pageB.goto(listUrl);
  await expect(pageB.getByRole("link", { name: initialTitle })).toBeVisible();

  // A: 編集画面に入ってフィールド編集・保存
  await openRecordEditor(page, initialTitle);
  const titleFromA = "Aタブからの更新";
  const titleInputA = page.getByRole("textbox", { name: "title" });
  await titleInputA.clear();
  await titleInputA.fill(titleFromA);
  await page.getByRole("button", { name: "保存" }).click();

  // B(一覧を開いたまま、reload なし)に反映されることを確認(WS push 経由)。
  await expect(pageB.getByRole("link", { name: titleFromA })).toBeVisible({ timeout: 15_000 });

  // 逆方向も 1 回: B が編集画面に入って編集・保存 → A(一覧に戻す)に反映される。
  await page.goto(listUrl);
  await openRecordEditor(pageB, titleFromA);
  const titleFromB = "Bタブからの更新";
  const titleInputB = pageB.getByRole("textbox", { name: "title" });
  await titleInputB.clear();
  await titleInputB.fill(titleFromB);
  await pageB.getByRole("button", { name: "保存" }).click();

  await expect(page.getByRole("link", { name: titleFromB })).toBeVisible({ timeout: 15_000 });

  await pageB.close();
});
