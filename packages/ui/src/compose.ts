import * as stylex from "@stylexjs/stylex";

// tech-selection §1.2: react-aria-components の className render prop（状態関数）と StyleX を
// 合成する唯一の経路。data 属性セレクタ（[data-hovered] 等）は StyleX の静的制約と相性が
// 悪いため、状態→スタイルの分岐は必ずこのヘルパー経由の render prop で行う。
//
// 注意: 組み込みの `Parameters<typeof stylex.props>` は、pnpm-workspace.yaml の catalog が
// pin する typescript 7.0.2（ネイティブコンパイラ）では stylex.props の rest パラメータが
// ReadonlyArray 型であることが原因で `never` に縮退する（microsoft/TypeScript#15972 系の
// readonly rest パラメータ推論の既知の制約）。`infer ... extends readonly unknown[]` で明示
// 制約した同型の抽出に置き換えて回避している（意味的には Parameters<> と同一のタプル型）。
type ParametersOf<TFn> = TFn extends (...args: infer TArgs extends readonly unknown[]) => unknown
  ? TArgs
  : never;
type StyleXArgs = ParametersOf<typeof stylex.props>;

export function stylexRenderProps<TState>(
  resolve: (state: TState) => StyleXArgs,
): (state: TState & { defaultClassName?: string | undefined }) => string {
  return (state) => stylex.props(...resolve(state)).className ?? "";
}
