import { ASSET_TYPE_DEFINITION } from "@plyrs/metamodel";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DONE_HOLD_MS, resetUploadStores } from "./lib/use-uploads";
import {
  articleType,
  bootstrapped,
  jsonResponse,
  renderAt,
  socketHarness,
} from "./test-utils/records-harness";
import { ASSET_1, ASSET_2, ASSET_3, assetRecord, mediaRoutes } from "./test-utils/media-harness";

vi.mock("./components/media/media-filter-select", async () => {
  const mock = await import("./test-utils/media-filter-select-mock");
  return { MediaFilterSelect: mock.MediaFilterSelectMock };
});

afterEach(() => {
  resetUploadStores();
  vi.useRealTimers();
});

// 送信を 1 件ずつ手で終わらせる(状態が「送信しています…」「順番待ち」で止まるように)
function deferredAssets() {
  const pending: Array<(response: Response) => void> = [];
  const handler = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        pending.push(resolve);
      }),
  );
  return { handler, pending };
}

function png(name: string, bytes = 3) {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

async function open(routes = mediaRoutes()) {
  const harness = socketHarness();
  renderAt("/t/blog/media", harness, routes);
  await vi.waitFor(() => expect(harness.sockets.length).toBe(1));
  await bootstrapped(
    harness.latest(),
    [assetRecord(ASSET_1, "one.png")],
    [ASSET_TYPE_DEFINITION, articleType],
  );
  await screen.findByRole("grid", { name: "メディアの一覧" });
  return harness;
}

// 画面にはシェルの同期状態も role=status で出るため、進捗の帯を文言で選ぶ
function progressBar(): HTMLElement | null {
  return (
    screen
      .queryAllByRole("status")
      .find((el) => el.textContent?.includes("アップロードしています")) ?? null
  );
}

function chooseFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("file input not found");
  fireEvent.change(input, { target: { files } });
}

describe("メディア(アップロード)", () => {
  it("ファイルを追加で 2 件を順に送り、仮タイルが進み、同期の change で実タイルに置き換わる", async () => {
    const { handler, pending } = deferredAssets();
    const harness = await open(mediaRoutes({ "/v1/t/t1/assets": handler }));
    vi.useFakeTimers({ shouldAdvanceTime: true });

    chooseFiles([png("a.png"), png("b.png")]);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect(
      within(screen.getByRole("group", { name: "a.png" })).getAllByText("送信しています…").length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByRole("group", { name: "b.png" })).getByText("順番待ち"),
    ).toBeInTheDocument();
    expect(progressBar()).toHaveTextContent("0 / 2 件が完了");

    await act(async () => {
      pending[0]?.(jsonResponse(201, { ok: true, record: { id: ASSET_2 } }));
    });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(progressBar()).toHaveTextContent("1 / 2 件が完了"));
    await act(async () => {
      pending[1]?.(jsonResponse(201, { ok: true, record: { id: ASSET_3 } }));
    });
    const region = await screen.findByRole("region", { name: "通知" });
    expect(await within(region).findByText("2 件のファイルをアップロードしました")).toBeTruthy();

    // 同期の change で実レコードが届くが、仮タイルが残る間は二重に出さない
    act(() => {
      harness.latest().deliver({ type: "change", record: assetRecord(ASSET_2, "a.png") });
      harness.latest().deliver({ type: "change", record: assetRecord(ASSET_3, "b.png") });
    });
    expect(screen.getByRole("group", { name: "a.png" })).toBeInTheDocument();
    expect(screen.getAllByText("a.png")).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DONE_HOLD_MS);
    });
    await waitFor(() => expect(screen.queryByRole("group", { name: "a.png" })).toBeNull());
    const grid = screen.getByRole("grid", { name: "メディアの一覧" });
    expect(within(grid).getAllByRole("row")).toHaveLength(3);
    expect(within(grid).getByText("a.png")).toBeInTheDocument();
    expect(within(grid).getByText("b.png")).toBeInTheDocument();
  });

  it("20 MB 超は送らずに弾き、理由と取り除くを出す。失敗は再試行で送り直す", async () => {
    let calls = 0;
    const handler = vi.fn(() => {
      calls += 1;
      if (calls === 2) return jsonResponse(500, { error: "boom" });
      return jsonResponse(201, { ok: true, record: { id: calls === 3 ? ASSET_3 : ASSET_2 } });
    });
    const harness = await open(mediaRoutes({ "/v1/t/t1/assets": handler }));

    const big = png("big.png");
    Object.defineProperty(big, "size", { value: 20 * 1024 * 1024 + 1 });
    chooseFiles([png("a.png"), png("b.png"), big]);

    const bigTile = await screen.findByRole("group", { name: "big.png" });
    expect(bigTile).toHaveTextContent("20 MB を超えるファイルはアップロードできません");
    const failedTile = await screen.findByRole("group", { name: "b.png" });
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(2));
    expect(within(failedTile).getByRole("button", { name: /再試行/ })).toBeInTheDocument();

    // 送らなかった 20 MB 超は assets に届いていない
    expect(handler).toHaveBeenCalledTimes(2);

    // 失敗の通知は danger tone(role="alert")で出る
    const region = await screen.findByRole("region", { name: "通知" });
    expect(await within(region).findByRole("alert")).toBeInTheDocument();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(failedTile).getByRole("button", { name: /再試行/ }));
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(3));

    // 再試行が成功し、同期の change が届いて仮タイルが消えると b.png は実タイル(row)になる
    act(() => {
      harness.latest().deliver({ type: "change", record: assetRecord(ASSET_3, "b.png") });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DONE_HOLD_MS);
    });
    await waitFor(() => expect(screen.queryByRole("group", { name: "b.png" })).toBeNull());
    const grid = screen.getByRole("grid", { name: "メディアの一覧" });
    expect(within(grid).getByText("b.png").closest('[role="row"]')).not.toBeNull();

    fireEvent.click(within(bigTile).getByRole("button", { name: /取り除く/ }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "big.png" })).toBeNull());
  });

  it("キャンセルすると順番待ちのタイルが消える", async () => {
    const { handler, pending } = deferredAssets();
    await open(mediaRoutes({ "/v1/t/t1/assets": handler }));
    chooseFiles([png("a.png"), png("b.png"), png("c.png")]);
    await screen.findByRole("group", { name: "c.png" });
    fireEvent.click(
      within(progressBar() as HTMLElement).getByRole("button", { name: "残りを中止" }),
    );
    await waitFor(() => expect(screen.queryByRole("group", { name: "c.png" })).toBeNull());
    expect(screen.queryByRole("group", { name: "b.png" })).toBeNull();
    expect(screen.getByRole("group", { name: "a.png" })).toBeInTheDocument();
    await act(async () => {
      pending[0]?.(jsonResponse(201, { ok: true, record: { id: ASSET_2 } }));
    });
    await waitFor(() => expect(progressBar()).toBeNull());
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
