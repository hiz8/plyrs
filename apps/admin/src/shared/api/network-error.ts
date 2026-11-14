// fetch がネットワークの失敗で投げるのは TypeError だが、本文はブラウザごとに違い、ハンドラ内の
// バグ(undefined.foo など)も同じ TypeError になる。fetch の呼び出しそのものが投げたものだけを
// この型に包み直し、errorMessage(案 H 4.2)は接続エラーをこの型だけで判定する。
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "NetworkError";
  }
}

// api-client / admin-api / super-api が受け取る fetch をこれで包む。応答を受け取れた後の失敗
// (JSON の解析など)は包まない。
export function withNetworkErrors(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (cause) {
      throw cause instanceof TypeError ? new NetworkError(cause) : cause;
    }
  };
}
