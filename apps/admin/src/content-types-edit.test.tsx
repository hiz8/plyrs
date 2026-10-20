import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES } from "./lib/error-messages";
import { ListColumnsSelectMock } from "./test-utils/list-columns-select-mock";
import {
  article,
  articleType,
  authedRoutes,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { summary } from "./test-utils/type-rows";

vi.mock("./components/content-types/list-columns-select", () => ({
  ListColumnsSelect: ListColumnsSelectMock,
}));

const articleSummary = summary({
  key: "article",
  id: articleType.id,
  name: "記事",
  version: 2,
  fields: [{ key: "title", type: "text", label: "タイトル" }],
});

function setup(
  options: { type?: typeof articleSummary; put?: () => Response; path?: string } = {},
) {
  const type = options.type ?? articleSummary;
  const handler = vi.fn((init?: RequestInit) =>
    init?.method === "PUT"
      ? (options.put?.() ?? jsonResponse(200, { ok: true, contentType: type }))
      : jsonResponse(200, { contentTypes: [type] }),
  );
  const harness = socketHarness();
  const router = renderAt(
    options.path ?? `/t/blog/settings/content-types/${type.key}/edit`,
    harness,
    authedRoutes({ "/v1/t/t1/content-types": handler }),
  );
  const puts = () => handler.mock.calls.filter(([init]) => init?.method === "PUT");
  const putBody = () => JSON.parse(String(puts()[0]?.[0]?.body)) as Record<string, unknown>;
  return { harness, router, puts, putBody };
}

describe("設定 › コンテンツタイプ(編集)", () => {
  it("既存のフィールドを必須にすると件数つきの注意が出て、保存すると PUT に入る", async () => {
    const { harness, puts, putBody } = setup();
    const user = userEvent.setup();
    await screen.findByRole("row", { name: /タイトル/ });
    await bootstrapped(
      harness.latest(),
      [
        article("018f2b6a-7a0a-7000-8000-0000000000a1", "記事 A"),
        article("018f2b6a-7a0a-7000-8000-0000000000a2", ""),
      ],
      [articleType],
    );
    await user.click(
      within(screen.getByRole("row", { name: /タイトル/ })).getByRole("button", { name: "編集" }),
    );
    const panel = await screen.findByRole("dialog", { name: "タイトル" });
    await user.click(within(panel).getByRole("checkbox", { name: "必須" }));
    await user.click(within(panel).getByRole("button", { name: "適用" }));
    const row = screen.getByRole("row", { name: /タイトル/ });
    expect(within(row).getByText("必須に変更")).toBeInTheDocument();
    expect(await within(row).findByText(/\(1 件\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(putBody()).toMatchObject({
      id: articleType.id,
      version: 2,
      key: "article",
      fields: [{ key: "title", required: true }],
    });
    // 暗黙のタイトルは適用しても titleField に書き込まれない
    expect(putBody().titleField).toBeUndefined();
  });

  it("一覧に表示する列を足すと listColumns が PUT に入る", async () => {
    const { puts, putBody } = setup();
    const user = userEvent.setup();
    await screen.findByRole("row", { name: /タイトル/ });
    await user.selectOptions(screen.getByRole("combobox", { name: "列を追加" }), "title");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(putBody()).toMatchObject({ listColumns: ["title"] });
  });

  it("保存が 409 なら利用者向けの文のトーストを出して画面に留まる", async () => {
    const { puts, router } = setup({ put: () => jsonResponse(409, { error: "key_mismatch" }) });
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: /^表示名/ }), "ニュース");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(
      await within(screen.getByRole("region", { name: "通知" })).findByText(
        ERROR_MESSAGES.key_mismatch ?? "",
      ),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/t/blog/settings/content-types/article/edit");
  });

  it("モジュールの型は読み取り専用で開き、保存が無い", async () => {
    setup({
      type: summary({
        key: "booking.slot",
        name: "予約枠",
        source: "plugin",
        pluginId: "booking",
        fields: [{ key: "starts", type: "datetime", label: "開始" }],
      }),
    });
    expect(await screen.findByText("モジュールの型(編集できません)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    fireEvent.click(
      within(await screen.findByRole("row", { name: /開始/ })).getByRole("button", {
        name: "詳細",
      }),
    );
    expect(await screen.findByRole("dialog", { name: "開始" })).toBeInTheDocument();
  });

  it("無い型は見つからない文を出す", async () => {
    setup({ path: "/t/blog/settings/content-types/ghost/edit" });
    expect(await screen.findByText(/コンテンツタイプが見つかりません: ghost/)).toBeInTheDocument();
  });
});
