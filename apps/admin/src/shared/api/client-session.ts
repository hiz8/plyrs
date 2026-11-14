import type { QueryClient } from "@tanstack/react-query";
import type { TokenManager } from "./token-manager";

// クライアント側のセッション状態(テナント JWT とクエリのキャッシュ)をまとめて捨てる。
// ログアウトだけでなくログイン・サインアップの成功直後にも呼ぶ: セッション失効で /login へ
// 戻された経路はログアウトを経ないため、前の利用者の JWT や自分の情報を次の利用者へ持ち越さない。
// 状態を足すときはここだけ直す(super 面はテナント JWT を持たないので対象外)。
export function resetClientSession({
  queryClient,
  tokens,
}: {
  queryClient: QueryClient;
  tokens: TokenManager;
}): void {
  tokens.clear();
  queryClient.clear();
}
