import { expect, test } from "@playwright/test";
import {
  createArticleTypeWithMedia,
  loginAsUser,
  provisionTenant,
  signupUser,
  superLogin,
} from "../helpers/setup";

// 1x1 の PNG(アップロードの本体。R2 へ入るので実在の画像にしておく)
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// playwright.config.ts の projects/dependencies により core-journey の後に実行される(直列の順序を保つため)。
// データは core-journey と共有せず、この spec 専用のユーザーとテナント(slug "media")を作る。
test("upload, edit alt, pick from the editor, and delete", async ({ page }) => {
  const email = `media+${Date.now()}@example.com`;
  const password = "user-password-123";

  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, { name: "Media", slug: "media", ownerEmail: email });

  await loginAsUser(page, email, password);
  await createArticleTypeWithMedia(page);

  const sidebar = page.getByRole("complementary");
  const toasts = page.getByRole("region", { name: "通知" });

  // アップロード(media-library.tsx の FileButton = 隠し input[type=file]。空状態の DropZone にも input があるので先頭)
  await sidebar.getByRole("link", { name: "メディア", exact: true }).click();
  await expect(page.getByRole("heading", { name: "メディア", level: 1 })).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: PNG_1X1 });
  // 仮タイル(group)ではなく、確定した行(GridListItem = row)の登場を待つ
  const library = page.getByRole("grid", { name: "メディアの一覧" });
  const libraryRow = library.getByRole("row", { name: /cover\.png/ });
  await expect(libraryRow).toBeVisible();

  // 詳細パネル(SidePanel = dialog、名前はファイル名)で代替テキストを保存
  await libraryRow.click();
  const panel = page.getByRole("dialog", { name: "cover.png" });
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "代替テキスト" }).fill("表紙");
  await panel.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toasts.getByText("保存しました")).toBeVisible();
  await page.waitForURL(/\/media\/[0-9a-f-]{36}/);
  await panel.getByRole("button", { name: "閉じる" }).click();
  await expect(panel).toHaveCount(0);

  // 編集画面のピッカーで選ぶ(single は replace なのでタイルのクリックで選べる)
  await sidebar.getByRole("link", { name: "記事", exact: true }).click();
  await page.getByRole("button", { name: "記事を追加" }).first().click();
  await page.getByRole("textbox", { name: "title" }).fill("表紙つき");
  await page.getByRole("button", { name: "メディアを選択" }).click();
  const picker = page.getByRole("dialog", { name: "メディアを選択" });
  await picker.getByRole("row", { name: /cover\.png/ }).click();
  await picker.getByRole("button", { name: "このファイルを使う" }).click();
  await expect(picker).toHaveCount(0);
  // 選択中のファイル名がフィールドに出る(asset-picker.tsx)
  await expect(page.getByText("cover.png", { exact: true })).toBeVisible();
  await page
    .getByRole("region", { name: "公開", exact: true })
    .getByRole("button", { name: "下書き保存" })
    .click();
  await page.waitForURL(/\/content\/article\/[0-9a-f-]{36}$/);

  // 使用中のファイルを削除する(確認に使用箇所の件数が出る)
  await sidebar.getByRole("link", { name: "メディア", exact: true }).click();
  await library.getByRole("row", { name: /cover\.png/ }).click();
  await page
    .getByRole("dialog", { name: "cover.png" })
    .getByRole("button", { name: "ファイルを削除" })
    .click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("1 件のコンテンツで使われています")).toBeVisible();
  await confirm.getByRole("button", { name: "削除する" }).click();
  await expect(toasts.getByText("削除しました")).toBeVisible();
  await expect(library.getByRole("row", { name: /cover\.png/ })).toHaveCount(0);
});
