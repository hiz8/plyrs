# plyrs 管理画面の部品集(@plyrs/ui)の使い方

日本語の CMS 管理画面(お知らせ・イベント・メディア・メンバーの管理)を作るための部品集。部品は react-aria-components を土台にし、見た目は StyleX でコンパイル済みの CSS(`styles.css` から読み込まれる)で付く。

## セットアップ

- プロバイダーは不要。`window.PlyrsUI.*` の部品をそのまま描画する
- 部品はライト / ダークの両方の色を `light-dark()` で持つ。ルートに `color-scheme` が無いと常にライトになる。ダークにも追従させるなら `<html style="color-scheme: light dark">`
- 部品の CSS は `body` の書体・色・余白を指定しない。画面のルートに次を当てること(当てないと部品の外の文字が明朝体になる):
  `font-family: system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif; font-size: 14px; color: #1a1f24; background: #ffffff; margin: 0`
- 文言は日本語の「です・ます」。ボタンは動詞で短く(保存 / 公開 / 削除する)。確認ダイアログの実行ボタンは「OK」にせず操作名にする

## 見た目の決め方

- 見た目は部品の props で決める。部品に className を足して上書きしない(CSS 変数名はハッシュ化されていて名前で参照できない)
- ボタン: `Button` の `variant` は primary(主操作。1 画面に 1 つ)/ secondary(補助)/ danger(危険)/ link / dangerLink、`size` は md / sm、`icon` に lucide-react のアイコン。アイコンだけのボタンは `IconButton`(`label` 必須)
- 状態の表示: `Badge` の `tone` は neutral / accent / success / warning / danger。公開状態は `dot` を付け、公開中 = success、未反映の変更あり = warning、未公開 = neutral
- ページは `PageHeader`(title / breadcrumbs / primaryAction / secondaryActions / banner)で始め、h1 はこれ 1 つだけ
- 一覧は `Table`(+ `TableHeader` / `Column` / `TableBody` / `Row` / `Cell`)と `Tabs`・`SearchField`、空のときは `EmptyState`、結果の通知は `ToastRegion` + `createToaster()`、危険な操作の確認は `ConfirmDialog`
- 部品の外のレイアウト(余白・並び)は inline style で、次の値だけを使う
  - 余白: 4 / 8 / 12 / 16 / 24 / 32 / 48px(本文の左右の余白は 24px)
  - 角丸: 面(カード)は 16px、入力欄・項目は 8px
  - 文字: 12 / 14 / 16 / 20 / 24px、太さ 400 / 500 / 600
  - 色(ライト): 地 #ffffff、面 #f6f7f8、罫線 #d8dde3、本文 #1a1f24、補足 #5f6b76、アクセント #2563eb
  - カードの面は「面の色 + 1px の罫線 + 角丸 16px」

## どこを読むか

- 各部品の API と例: `components/<group>/<Name>/<Name>.d.ts` と `<Name>.prompt.md`
- 部品の色・寸法の実体: `_ds_bundle.css`(`styles.css` が読み込む)

## 例

```jsx
const { PageHeader, Button, Table, TableHeader, Column, TableBody, Row, Cell, Badge } = window.PlyrsUI;

<div style={{ fontFamily: "system-ui, 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif", fontSize: 14, color: "#1a1f24" }}>
  <PageHeader
    title="お知らせ"
    breadcrumbs={[{ id: "home", label: "ホーム", href: "#" }, { id: "news", label: "お知らせ" }]}
    primaryAction={<Button>お知らせを追加</Button>}
  />
  <div style={{ padding: 24 }}>
    <Table aria-label="お知らせ" selectionMode="multiple">
      <TableHeader>
        <Column id="title" isRowHeader allowsSorting>タイトル</Column>
        <Column id="status">公開</Column>
      </TableHeader>
      <TableBody items={[{ id: "1", title: "年末年始の営業について" }]}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.title}</Cell>
            <Cell><Badge tone="success" dot>公開中</Badge></Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
</div>
```
