// Cloudflare Turnstile のスクリプトローダー(React 非依存)。explicit レンダリング
// (?render=explicit)を使う — ウィジェットの render/remove を React コンポーネントの
// マウント/アンマウントに合わせて自前で呼びたいため、自動レンダリングは使わない
// (公式ドキュメント推奨の統合方式)。onload は window 上のグローバル関数名として登録し、
// スクリプト側から呼び出される仕組み。

export interface TurnstileRenderParams {
  sitekey: string;
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, params: TurnstileRenderParams): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const ONLOAD_CALLBACK_NAME = "__plyrsTurnstileOnload";

let loadPromise: Promise<TurnstileApi> | null = null;

// アプリ生存期間中、script タグは 1 回だけ注入する。二重呼び出しは同じ Promise を返す
// (idempotent)。既に window.turnstile があれば(他経路でロード済みなら)即 resolve。
export function loadTurnstile(): Promise<TurnstileApi> {
  if (loadPromise !== null) {
    return loadPromise;
  }
  if (window.turnstile !== undefined) {
    loadPromise = Promise.resolve(window.turnstile);
    return loadPromise;
  }
  loadPromise = new Promise((resolve, reject) => {
    // onload のコールバック名は動的なグローバルプロパティなので、Window の型を汚さないよう
    // 境界だけ unknown 経由でキャストする(vitest.setup.ts の DOMRectList キャストと同じ方針)。
    const globalScope = window as unknown as Record<string, () => void>;
    globalScope[ONLOAD_CALLBACK_NAME] = () => {
      if (window.turnstile === undefined) {
        reject(new Error("turnstile script loaded but window.turnstile is missing"));
        return;
      }
      resolve(window.turnstile);
    };
    const script = document.createElement("script");
    script.src = `${SCRIPT_SRC}?render=explicit&onload=${ONLOAD_CALLBACK_NAME}`;
    script.async = true;
    script.addEventListener("error", () =>
      reject(new Error("failed to load the turnstile script")),
    );
    document.head.appendChild(script);
  });
  return loadPromise;
}
