import * as stylex from "@stylexjs/stylex";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@plyrs/ui";
import { superStyles } from "./-styles";

interface DeadLetterRow {
  id: string;
  queue: string;
  body: string;
  failedAt: string;
  replayedAt: string | null;
}

const DLQ_QUERY_KEY = ["super", "dead-letters"] as const;

export const Route = createFileRoute("/super/dlq")({
  component: SuperDlqPage,
});

function SuperDlqPage() {
  const { superApi } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const dlq = useQuery({
    queryKey: DLQ_QUERY_KEY,
    queryFn: () => superApi.get<{ deadLetters: DeadLetterRow[] }>("/super/v1/dead-letters"),
  });

  const [replayError, setReplayError] = useState<string | null>(null);
  const replayMutation = useMutation({
    mutationFn: (id: string) =>
      superApi.post<{ ok: boolean }>(`/super/v1/dead-letters/${id}/replay`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DLQ_QUERY_KEY }),
  });

  async function replay(id: string) {
    setReplayError(null);
    try {
      await replayMutation.mutateAsync(id);
    } catch {
      setReplayError("再投入に失敗しました");
    }
  }

  const [discardTarget, setDiscardTarget] = useState<DeadLetterRow | null>(null);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const discardMutation = useMutation({
    mutationFn: (id: string) => superApi.delete<{ ok: boolean }>(`/super/v1/dead-letters/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DLQ_QUERY_KEY }),
  });

  function startDiscard(row: DeadLetterRow) {
    setDiscardTarget(row);
    setDiscardError(null);
  }

  async function confirmDiscard() {
    if (discardTarget === null) {
      return;
    }
    setDiscardError(null);
    try {
      await discardMutation.mutateAsync(discardTarget.id);
      setDiscardTarget(null);
    } catch {
      setDiscardError("破棄に失敗しました");
    }
  }

  const rows = dlq.data?.deadLetters ?? [];

  return (
    <>
      <h1 {...stylex.props(superStyles.title)}>DLQ</h1>
      {dlq.isError ? (
        <p role="alert" {...stylex.props(superStyles.banner)}>
          デッドレター一覧を取得できませんでした
        </p>
      ) : null}
      {dlq.isPending ? (
        <p {...stylex.props(superStyles.muted)}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p {...stylex.props(superStyles.muted)}>デッドレターはありません</p>
      ) : (
        <table {...stylex.props(superStyles.table)}>
          <caption {...stylex.props(superStyles.caption)}>デッドレターの一覧</caption>
          <thead>
            <tr>
              <th {...stylex.props(superStyles.cell)}>キュー</th>
              <th {...stylex.props(superStyles.cell)}>失敗日時</th>
              <th {...stylex.props(superStyles.cell)}>再投入日時</th>
              <th {...stylex.props(superStyles.cell)}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td {...stylex.props(superStyles.cell)}>{row.queue}</td>
                <td {...stylex.props(superStyles.cell)}>{row.failedAt}</td>
                <td {...stylex.props(superStyles.cell)}>{row.replayedAt ?? "-"}</td>
                <td {...stylex.props(superStyles.cell)}>
                  <span {...stylex.props(superStyles.actions)}>
                    <Button
                      variant="secondary"
                      isDisabled={replayMutation.isPending}
                      onPress={() => void replay(row.id)}
                    >
                      再投入
                    </Button>
                    <Button variant="secondary" onPress={() => startDiscard(row)}>
                      破棄
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {replayError !== null ? (
        <p role="alert" {...stylex.props(superStyles.banner)}>
          {replayError}
        </p>
      ) : null}
      {discardTarget !== null && (
        <div
          role="alertdialog"
          aria-label="デッドレターの破棄"
          {...stylex.props(superStyles.dialog)}
        >
          <h2 {...stylex.props(superStyles.dialogTitle)}>このデッドレターを破棄しますか?</h2>
          {discardError !== null ? (
            <p role="alert" {...stylex.props(superStyles.banner)}>
              {discardError}
            </p>
          ) : null}
          <span {...stylex.props(superStyles.actions)}>
            <Button
              variant="secondary"
              isDisabled={discardMutation.isPending}
              onPress={() => void confirmDiscard()}
            >
              破棄を確定
            </Button>
            <Button variant="secondary" onPress={() => setDiscardTarget(null)}>
              キャンセル
            </Button>
          </span>
        </div>
      )}
    </>
  );
}
