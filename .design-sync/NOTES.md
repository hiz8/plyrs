# design-sync メモ(plyrs / @plyrs/ui)

## ビルド
- packages/ui は src を直接 export しており dist が無い。StyleX はコンパイルが必須なので、同期用のビルドを `.design-sync/ui-build.vite.mjs`(Vite のライブラリビルド、StyleX + lightningcss の LightDark 除外)と `.design-sync/ui-dts.tsconfig.json`(型定義)で `.design-sync/.cache/ui-dist/` に出す。手順は config の `buildCmd`
- 変換ツールは `--entry` から最寄りの名前付き package.json をパッケージの置き場所とみなすため、Vite のビルドが ui-dist に `package.json`(name: @plyrs/ui)を出す。`cssEntry` はそこからの相対 `assets/stylex.css`
- 型定義の展開に @types/react が要るため、`.design-sync/.cache/node_modules` → `packages/ui/node_modules` のリンクを置く(buildCmd の最後)
- 変換: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules packages/ui/node_modules --entry .design-sync/.cache/ui-dist/index.js --out ./ds-bundle`
- pnpm は PATH に無い → `corepack pnpm`。Playwright 1.63(chromium-1243 がキャッシュ済み)を `.ds-sync` に入れて描画チェックに使う
- グループ分けは `.design-sync/docs/<Name>.md` の frontmatter の `category` だけのスタブ(`docsDir: ../../docs`)

## 再同期の手順
1. `.ds-sync/` を作り直す(スキルの base dir から package-build.mjs / package-validate.mjs / package-capture.mjs / resync.mjs / lib / storybook をコピーし、`npm i esbuild ts-morph @types/react playwright@<repo の @playwright/test の版>`)
2. config の `buildCmd` を実行(packages/ui を変えたときは必須)
3. プロジェクトの `_ds_sync.json` を `.design-sync/.cache/remote-sync.json` に取得し、
   `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules packages/ui/node_modules --entry .design-sync/.cache/ui-dist/index.js --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json`

## プレビューを書くときの知見
- 描画環境に日本語フォントが無く、スクリーンショットでは日本語が豆腐になる(利用者のブラウザでは正しく出る)。採点は形・色・並びで行う
- 描画幅が 960px 未満なので、Table の `hideOnNarrow` の列は隠れる。プレビューでは `hideOnNarrow` を付けない
- テーマは `light-dark()` で、描画環境はライト
- import は `@plyrs/ui`(部品)と `lucide-react`(アイコン)。部品の props は ds-bundle/components/<group>/<Name>/<Name>.d.ts が正
- 浮く部品(ModalDialog / ConfirmDialog / Menu 系 / Tooltip / ToastRegion)は config の overrides で `cardMode: single`・`viewport: 720x480`

- 開く props の無い部品は、プレビューのラッパーで描画後に開く: Menu 系は 50ms 後にトリガーの button を click、Tooltip は内側の button を focus(delay=0)。ToastRegion は createToaster() + useEffect で success / error。ModalDialog / ConfirmDialog は isOpen
- 構成部品(MenuItem / MenuSection / MenuSeparator / TableHeader / Column / TableBody / Row / Cell)は親を含む全体で描き、その部品が主役の構成にする(Menu の複製にしない)
- DS は body のフォント・色を指定しない。プレビューで部品の外に地の文を置くときは、外側の div に font-family(system-ui … 'Noto Sans JP')を当てる。admin の画面側にも同じ穴がある(styles.css に body の font 指定が無い)
- 幅の広い部品は overrides で `cardMode: column`、Select は `single`(候補の Popover が fixed で枠外に出るため)
- 静的に描けない状態: IconButton のツールチップ(Tooltip のカードで代表)、Select の開いた一覧、DropZone のドラッグ中、表の無効行・ホバー・フォーカス
- Badge の tone は neutral / accent / success / warning / danger のみ(info は無い)
- Drawer は浮く部品。overrides で `cardMode: single`・`viewport: 720x480`、プレビューは `isOpen` で開く(ModalDialog と同じ)
- Avatar は `name` と `size`(sm / md)だけの小さな部品で、カードは `column` でよい

## 同期中に見つけて直した部品の不具合
- Select: 既定の SelectValue が選択中の候補の中身(check 用の 16px の空き枠)を複製し、トリガーの値が右にずれていた → `SelectValue` の children で selectedText だけを出す(packages/ui/src/select.tsx、テスト追加)

## 部品側の気づき(未対応)
- Table の Row に無効(isDisabled / disabledKeys)の見た目が無い
- ConfirmDialog の isPending は実行ボタンが薄くなるだけで、処理中の表示(Spinner)は無い

## V2 で変えた部品
- `PageHeader`(title が ReactNode、狭い幅で左右 16px)
- `MenuItem`(`detail` で右寄せの補足)
- `Table`(選択列・セルの focusVisible。RAC がフォーカスを中のチェックボックスへ転送するため、見た目はチェックボックスの輪で担保される)
- 新規 `Avatar` / `Drawer`
- 再同期が必要(上の「再同期の手順」)。スタブは `.design-sync/docs/` に追加済み

## V3 で変えた部品
- `TextField` / `TextArea`(`isReadOnly`: 枠線なし・下罫線だけ・地は透明)
- `Checkbox` / `CheckboxGroup`(`isReadOnly`: 箱はそのまま・カーソルは default・`aria-readonly`)
- `Select`(`isReadOnly`: トリガーの代わりに選択中の文字を下罫線付きで出す。`size`: `"md" | "sm"`、sm は高さ `size.controlSm`・文字 `font.caption`)
- `RichTextEditor`(`isReadOnly`: 編集不可・ツールバー無し・下罫線だけ)
- `PageHeader`(`meta`: 見出しの右・操作の左に補足)
- `Tabs`(狭い幅でタブの並びが横スクロール)
- 再同期が必要(上の「再同期の手順」)

## Known render warns
(無し。GRID_OVERFLOW は overrides で対応済み)

## Re-sync risks
- packages/ui に正式なビルドが無く、同期用のビルドは `.design-sync/ui-build.vite.mjs` に依存する。packages/ui の依存や StyleX の版を上げたら、まずこのビルドが通るか確かめる
- 撮影環境に日本語フォントが無く、採点は形・色・並びで行った。文字の詰まりや改行は実ブラウザで未確認
- Menu・Tooltip の開いた状態は setTimeout / focus の時間に依存する。撮影が速すぎると閉じた状態で撮られうる
- グループ分けは `.design-sync/docs/` のスタブ。部品を足したらスタブも足す(無いと general に入る)

## V4 で変えた部品
- `ProgressBar`(`isLabelHidden`: `aria-label` は残し、見た目の題を描かず値の文字だけ右寄せにする)
- `Select`(`isLabelHidden`: ラベルを VisuallyHidden で包み、アクセシブルネームだけ残して見た目を出さない。表の行内の選択用)
- `Toaster.clear()`(溜まった通知をすべて消す)
- `HomeWidgetContribution`(`size?: "half" | "full"`、`moduleId?: string`。型だけの変更で見た目は無し)
- `SegmentedControl`(RAC RadioGroup ベースの 3 択 pill。案 G 6.2 のテーマ切り替え用、裁定 G2)
- `Tabs`(`keyboardActivation?: "automatic" | "manual"`。manual は矢印キーでフォーカスだけ動かし、Enter / Space で選ぶ。URL を移るタブ用、設定のタブ)
- `SortableList`(新規。RAC GridList + useDragAndDrop の並べ替え。つまみ + キーボード DnD、行の間に点線の DropIndicator、E1。`isBusy` で保存中は DnD だけ止める(つまみは描いたまま。フォーカスを失わないよう GridList を作り直さない)。`isDisabled` は読み取り専用でつまみを描かない)
- `ModalDialog`(`size?: "md" | "lg"`。lg は幅 640px、既定 md は 440px、E23)
- `SidePanel`(新規。非モーダルの右パネル 420px、狭い画面は全面のシート、E2。Esc は IME の変換中は閉じない。ルートは `div`(名前の無い complementary を避ける))
- `Button`(`variant="card"`: 縦に積む選択肢のカード。幅 100%・高さ auto、選択中は `aria-pressed` で accent の面と枠。種類のカード、E33)
- 再同期は V4-F の最後にまとめて行う
