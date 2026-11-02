import { expect, test } from "@playwright/test";
import {
  createArticleRecord,
  createArticleType,
  loginAsUser,
  openRecordEditor,
  provisionTenant,
  publishRecord,
  signupUser,
  superLogin,
} from "../helpers/setup";

// 16.5(M2-5): record の履歴画面。playwright.config.ts の projects/dependencies により
// core-journey の後に実行される。テナントは別(history)。
//
// 履歴の区切り規則(design-spec 16.5): 同じ人が管理画面から続けて編集すると 15 分以内は
// 1 つの版に畳み込まれる。版を複数作るには publish を挟む(publish の版は常に切れ、その直後の
// 編集も新しい版になる)。
test("edit history shows versions and restores the first one", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `history+${Date.now()}@example.com`;
  const password = "user-password-123";

  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, { name: "History", slug: "history", ownerEmail: email });

  await loginAsUser(page, email, password);
  await createArticleType(page);
  const first = "初版の記事";
  await createArticleRecord(page, first);
  await openRecordEditor(page, first);
  await publishRecord(page);

  // 2 版目: 改題して公開せずに保存(publish の後なので新しい版になる。公開中の record では
  // 公開ボックスのボタンが「公開せずに保存」/「更新」になる)
  const second = "改題した記事";
  const title = page.getByRole("textbox", { name: "title" });
  await title.clear();
  await title.fill(second);
  // 初版作成の「保存しました」トースト(5 秒で消える)が残っていると、この保存のトーストと
  // 2 つ並んで strict mode に引っかかる。消えるのを待ってから保存する
  const toasts = page.getByRole("region", { name: "通知" });
  await expect(toasts.getByText("保存しました")).toHaveCount(0);
  await page.getByRole("button", { name: "公開せずに保存" }).first().click();
  await expect(toasts.getByText("保存しました")).toBeVisible();

  // 履歴画面: 公開版の疑似行 + 版(write / publish / write)
  await page.getByRole("button", { name: "履歴" }).click();
  await expect(page.getByRole("heading", { name: "履歴", level: 1 })).toBeVisible({
    timeout: 45_000,
  });
  const list = page.getByRole("list", { name: "版の一覧" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByText("公開版")).toBeVisible();

  // いちばん古い版(初版)を選ぶと、現在との差分に初版のタイトルが出る
  await list.getByRole("button").last().click();
  const diff = page.getByRole("region", { name: "現在との差分" });
  await expect(diff.getByText(first)).toBeVisible();
  await expect(diff.getByText(second)).toBeVisible();

  // 初版に戻すと編集画面へ戻り、タイトルが初版の値になっている
  await diff.getByRole("button", { name: "この版に戻す" }).click();
  const dialog = page.getByRole("dialog", { name: "この版に戻しますか？" });
  await dialog.getByRole("button", { name: "この版に戻す" }).click();
  await page.waitForURL(/\/content\/article\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "title" })).toHaveValue(first);

  // 復元も履歴に残る(公開版の疑似行の次、版の先頭に restore の版が増える)
  await page.getByRole("button", { name: "履歴" }).click();
  await expect(page.getByRole("heading", { name: "履歴", level: 1 })).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list.getByRole("listitem").nth(1)).toContainText("復元");
});
