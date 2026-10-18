import { Badge, Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const rows = [
  { id: "1", title: "年末年始の営業について", status: "公開中", tone: "success", author: "山田 花子" },
  { id: "2", title: "秋のキャンペーンのお知らせ", status: "レビュー中", tone: "accent", author: "佐藤 太郎" },
  { id: "3", title: "新しい店舗がオープンします", status: "下書き", tone: "neutral", author: "鈴木 一郎" },
  { id: "4", title: "旧キャンペーンの終了", status: "未反映の変更あり", tone: "warning", author: "山田 花子" },
] as const;

export const BadgeCells = () => (
  <div style={{ width: 600 }}>
    <Table aria-label="お知らせ">
      <TableHeader>
        <Column id="title" isRowHeader>
          タイトル
        </Column>
        <Column id="status">ステータス</Column>
        <Column id="author">作成者</Column>
      </TableHeader>
      <TableBody items={rows}>
        {(r) => (
          <Row id={r.id}>
            <Cell>{r.title}</Cell>
            <Cell>
              <Badge tone={r.tone} dot>
                {r.status}
              </Badge>
            </Cell>
            <Cell>{r.author}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);

export const TextCells = () => (
  <div style={{ width: 480 }}>
    <Table aria-label="メディア">
      <TableHeader>
        <Column id="name" isRowHeader>
          ファイル名
        </Column>
        <Column id="size">サイズ</Column>
      </TableHeader>
      <TableBody
        items={[
          { id: "1", name: "hero.jpg", size: "2.4 MB" },
          { id: "2", name: "ロゴ.svg", size: "12 KB" },
        ]}
      >
        {(r) => (
          <Row id={r.id}>
            <Cell>{r.name}</Cell>
            <Cell>{r.size}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);
