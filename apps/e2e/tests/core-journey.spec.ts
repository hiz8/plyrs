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

// playwright.config.ts の projects/dependencies により super-console.spec.ts の後に実行される
// (super 管理者の bootstrap を前提にできる)。
test("signup to published public API", async ({ page }) => {
  const email = `user+${Date.now()}@example.com`;
  const password = "user-password-123";

  // API 準備: user signup + super ログイン(bootstrap 済み)+ テナント発行(owner 任命)
  await signupUser(page.request, { email, password });
  await superLogin(page.request);
  await provisionTenant(page.request, { name: "Journey", slug: "journey", ownerEmail: email });

  // UI: ログイン → テナント → 型作成 → record 作成 → publish
  await loginAsUser(page, email, password);
  await createArticleType(page, "Journey");
  const title = "スモーク記事";
  await createArticleRecord(page, title);
  await openRecordEditor(page, title);
  await publishRecord(page);

  // 公開 API(dev 限定転送): 投影は結果整合なのでポーリングし、実際に記事が現れることまで見る
  // (このエンドポイントは未公開でも空配列で 200 を返すため、ステータスだけでは投影完了を
  // 検証できない — items に対象記事が現れることを条件にする)。
  await expect
    .poll(
      async () => {
        const res = await page.request.get("/public/v1/journey/records/article");
        if (res.status() !== 200) return -1;
        const body = (await res.json()) as { items: { fields?: { title?: string } }[] };
        return body.items.filter((item) => item.fields?.title === title).length;
      },
      { timeout: 30_000 },
    )
    .toBe(1);
});
