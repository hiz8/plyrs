import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SyncRecord } from "@plyrs/sync-protocol";
import { describe, expect, it, vi } from "vitest";
import {
  article,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
  type Handler,
} from "./test-utils/records-harness";

const BASE = "/t/blog/content/article";

function id(n: number): string {
  return `018f2b6a-7a0a-7000-8000-0000000003${String(n).padStart(2, "0")}`;
}

function publicationsOf(entries: { recordId: string; sourceVersion: number }[]): Handler {
  return vi.fn(() =>
    jsonResponse(200, {
      publications: entries.map((e) => ({ ...e, publishedAt: "2026-07-17T00:00:00Z" })),
      nextCursor: null,
    }),
  );
}

async function setup(
  path: string,
  records: SyncRecord[],
  options: { publications?: Handler; role?: string } = {},
) {
  const harness = socketHarness();
  const routes = authedRoutes(
    options.publications === undefined ? {} : { "/v1/t/t1/publications": options.publications },
    options.role,
  );
  const router = renderAt(path, harness, routes);
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(harness.latest(), records);
  return { router, user: userEvent.setup() };
}

// URL のクエリ(検証前の文字列から。router.state.location.search は検証後で既定値を含む)
function urlSearch(router: { state: { location: { searchStr: string } } }) {
  return Object.fromEntries(new URLSearchParams(router.state.location.searchStr));
}

async function table() {
  return within(await screen.findByRole("grid", { name: "記事の一覧" }));
}

async function rowCount() {
  return (await table()).getAllByRole("row").length - 1;
}

// 公開中 1・未反映 1・未公開 1
function threeRecords() {
  return {
    records: [
      article(id(1), "公開済みの記事", { version: 1 }),
      article(id(2), "直した記事", { version: 2 }),
      article(id(3), "書きかけの記事", { version: 1 }),
    ],
    publications: publicationsOf([
      { recordId: id(1), sourceVersion: 1 },
      { recordId: id(2), sourceVersion: 1 },
    ]),
  };
}

describe("一覧（/t/$tenantSlug/content/$typeKey）", () => {
  it("タブに件数が付き、公開中タブで公開中だけを出す", async () => {
    const { records, publications } = threeRecords();
    const { router, user } = await setup(BASE, records, { publications });
    expect(await screen.findByRole("tab", { name: /^すべて\s*3$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^公開中\s*2$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^未反映の変更あり\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^未公開\s*1$/ })).toBeInTheDocument();
    expect(await rowCount()).toBe(3);

    await user.click(screen.getByRole("tab", { name: /公開中/ }));
    await vi.waitFor(() => expect(urlSearch(router)).toEqual({ tab: "published" }));
    expect(await rowCount()).toBe(2);
    expect((await table()).queryByText("書きかけの記事")).not.toBeInTheDocument();
  });

  it("検索語は URL の q に入り、タイトルの部分一致で絞る", async () => {
    const { records, publications } = threeRecords();
    const { router, user } = await setup(BASE, records, { publications });
    await user.type(await screen.findByRole("searchbox", { name: "タイトルで検索" }), "直した");
    await vi.waitFor(() => expect(urlSearch(router)).toEqual({ q: "直した" }));
    expect(await rowCount()).toBe(1);
    expect((await table()).getByText("直した記事")).toBeInTheDocument();
  });

  it("ステータスの絞り込みとタブは組み合わさる", async () => {
    const records = [
      article(id(1), "公開の下書き", { status: "draft" }),
      article(id(2), "公開の完了", { status: "ready" }),
      article(id(3), "未公開の下書き", { status: "draft" }),
    ];
    const publications = publicationsOf([
      { recordId: id(1), sourceVersion: 1 },
      { recordId: id(2), sourceVersion: 1 },
    ]);
    await setup(`${BASE}?tab=published&status=draft`, records, { publications });
    expect(await rowCount()).toBe(1);
    expect((await table()).getByText("公開の下書き")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /公開中/ })).toHaveAttribute("aria-selected", "true");
  });

  it("タイトルの見出しで五十音順に並べ替え、URL に sort が入る", async () => {
    const records = [
      article(id(1), "う", { updatedAt: "2026-07-17T03:00:00Z" }),
      article(id(2), "あ", { updatedAt: "2026-07-17T02:00:00Z" }),
      article(id(3), "い", { updatedAt: "2026-07-17T01:00:00Z" }),
    ];
    const { router, user } = await setup(BASE, records);
    await table();
    await user.click(await screen.findByRole("columnheader", { name: /タイトル/ }));
    await vi.waitFor(() => expect(urlSearch(router)).toEqual({ sort: "title" }));
    const names = (await table())
      .getAllByRole("rowheader")
      .map((cell) => cell.textContent?.replace(/編集削除/, ""));
    expect(names).toEqual(["あ", "い", "う"]);
  });

  it("21 件で 2 ページに分かれ、次のページで URL に page=2 が入る", async () => {
    const records = Array.from({ length: 21 }, (_, i) => article(id(i + 1), `記事 ${i + 1}`));
    const { router, user } = await setup(BASE, records);
    expect(await rowCount()).toBe(20);
    await user.click(screen.getByRole("button", { name: "次のページ" }));
    await vi.waitFor(() => expect(urlSearch(router)).toEqual({ page: "2" }));
    expect(await rowCount()).toBe(1);
  });

  it("範囲外の page は最後のページに寄せ、未知の tab は既定に戻す", async () => {
    const records = Array.from({ length: 20 }, (_, i) => article(id(i + 1), `記事 ${i + 1}`));
    await setup(`${BASE}?page=99&tab=xxx`, records);
    expect(await rowCount()).toBe(20);
    expect(screen.getByRole("tab", { name: /^すべて/ })).toHaveAttribute("aria-selected", "true");
  });

  it("0 件は空状態だけを出し、絞り込みで 0 件はタブを残して「絞り込みを解除」を出す", async () => {
    const empty = await setup(BASE, []);
    expect(await screen.findByText("記事はまだありません")).toBeInTheDocument();
    // 見出しの主操作と空状態の導線
    expect(screen.getAllByRole("button", { name: "記事を追加" })).toHaveLength(2);
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    expect(empty.router.state.location.pathname).toBe(BASE);
  });

  it("絞り込みで 0 件のときはタブを残し、解除で戻る", async () => {
    const { records, publications } = threeRecords();
    const { router, user } = await setup(`${BASE}?q=zzz&status=draft`, records, { publications });
    const status = (
      await screen.findByText("「zzz」に一致する記事はありません")
    ).closest<HTMLElement>('[role="status"]');
    if (status === null) throw new Error("expected a status region");
    expect(within(status).getByText("「zzz」に一致する記事はありません")).toBeInTheDocument();
    expect(within(status).getByText(/ステータス「下書き」で絞り込んでいます/)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    await user.click(within(status).getByRole("button", { name: "絞り込みを解除" }));
    await vi.waitFor(() => expect(urlSearch(router)).toEqual({}));
    expect(await rowCount()).toBe(3);
  });

  it("公開状態の取得に失敗したら再試行を出す", async () => {
    let ok = false;
    const publications: Handler = vi.fn(() =>
      ok
        ? jsonResponse(200, { publications: [], nextCursor: null })
        : jsonResponse(500, { error: "internal" }),
    );
    const { user } = await setup(BASE, [article(id(1), "ある記事")], { publications });
    expect(await screen.findByRole("status", { name: "読み込み中" })).toBeInTheDocument();
    const alert = await screen.findByRole("alert", {}, { timeout: 12_000 });
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
    ok = true;
    await user.click(within(alert).getByRole("button", { name: "再試行" }));
    expect(await rowCount()).toBe(1);
  }, 20_000);

  it("閲覧者には追加ボタン・選択列が無く「閲覧のみ」が出る", async () => {
    await setup(BASE, [article(id(1), "ある記事")], { role: "viewer" });
    const rows = await table();
    expect(screen.getByText("閲覧のみ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "記事を追加" })).not.toBeInTheDocument();
    expect(rows.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("更新日時は相対表記で ISO 文字列を出さない", async () => {
    const updatedAt = new Date(Date.now() - 3 * 60_000).toISOString();
    await setup(BASE, [article(id(1), "ある記事", { updatedAt })]);
    const rows = await table();
    expect(rows.getByText(/3 分前/)).toBeInTheDocument();
    expect(rows.queryByText(updatedAt)).not.toBeInTheDocument();
  });

  it("同期の完了までは読み込み中を出す", async () => {
    const harness = socketHarness();
    renderAt(BASE, harness);
    expect(
      await screen.findByRole("heading", { level: 1, name: "読み込み中" }),
    ).toBeInTheDocument();
  });
});
