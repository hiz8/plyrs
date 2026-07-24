import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { loadTurnstile, type TurnstileApi } from "../lib/turnstile";

const styles = stylex.create({
  root: {},
});

// マウントで loadTurnstile() → render()、アンマウントで remove()(explicit レンダリング
// なので自前でライフサイクルを合わせる)。トークンは約 300 秒で失効し expired-callback が
// 呼ばれる仕様のため、expired/error はどちらも onToken(null) にして送信側の「トークン
// 未取得」ガードに委ねる。error-callback は公式推奨どおり widget を reset し、ユーザーが
// 再チャレンジできるようにする。script のロード自体が失敗した場合も onToken(null) のまま
// (widget を表示できないので reset 対象がない)。
export function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // onToken は親の再レンダーごとに新しい関数参照になり得る(controlled input 等)。
  // 依存配列に含めると再レンダーのたびに widget を破棄・再生成してしまうため、最新の参照
  // だけ ref に保持し、callback からはそれ経由で呼ぶ(effect 自体は siteKey にのみ依存)。
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;
    let api: TurnstileApi | null = null;

    void loadTurnstile()
      .then((turnstile) => {
        if (cancelled || containerRef.current === null) {
          return;
        }
        api = turnstile;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => {
            onTokenRef.current(null);
            if (widgetId !== null) {
              turnstile.reset(widgetId);
            }
          },
        });
      })
      .catch(() => {
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId !== null && api !== null) {
        api.remove(widgetId);
      }
    };
  }, [siteKey]);

  return <div ref={containerRef} {...stylex.props(styles.root)} />;
}
