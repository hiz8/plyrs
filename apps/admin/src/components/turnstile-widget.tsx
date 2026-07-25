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
// 再チャレンジできるようにする。script のロード自体が失敗した場合は onToken(null) に加えて
// onLoadError を呼び、呼び出し側がエラー表示・再試行導線を出せるようにする。
export function TurnstileWidget({
  siteKey,
  onToken,
  onLoadError,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onLoadError?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // onToken/onLoadError は親の再レンダーごとに新しい関数参照になり得る(controlled input 等)。
  // 依存配列に含めると再レンダーのたびに widget を破棄・再生成してしまうため、最新の参照
  // だけ ref に保持し、callback からはそれ経由で呼ぶ(effect 自体は siteKey にのみ依存)。
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

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
          // cancelled ガード: remove() 呼び出し前に非同期発火した場合の防御(Cloudflare 側の
          // タイミングに依存させず、アンマウント後は常に無視する)。
          callback: (token) => {
            if (cancelled) return;
            onTokenRef.current(token);
          },
          "expired-callback": () => {
            if (cancelled) return;
            onTokenRef.current(null);
          },
          "error-callback": () => {
            if (cancelled) return;
            onTokenRef.current(null);
            if (widgetId !== null) {
              turnstile.reset(widgetId);
            }
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        onTokenRef.current(null);
        onLoadErrorRef.current?.();
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
