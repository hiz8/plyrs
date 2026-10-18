import { Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const items = [
  { id: "1", title: "年末年始の営業について", updated: "10 分前" },
  { id: "2", title: "秋のキャンペーンのお知らせ", updated: "3 時間前" },
  { id: "3", title: "新しい店舗がオープンします", updated: "昨日" },
  { id: "4", title: "メンテナンスのお知らせ", updated: "3 日前" },
];

const header = (
  <TableHeader>
    <Column id="title" isRowHeader>
      タイトル
    </Column>
    <Column id="updated">更新</Column>
  </TableHeader>
);

const rows = (
  <TableBody items={items}>
    {(r) => (
      <Row id={r.id}>
        <Cell>{r.title}</Cell>
        <Cell>{r.updated}</Cell>
      </Row>
    )}
  </TableBody>
);

export const Default = () => (
  <div style={{ width: 480 }}>
    <Table aria-label="お知らせ">
      {header}
      {rows}
    </Table>
  </div>
);

export const SelectedRows = () => (
  <div style={{ width: 480 }}>
    <Table aria-label="お知らせ" selectionMode="multiple" defaultSelectedKeys={["2", "3"]}>
      {header}
      {rows}
    </Table>
  </div>
);
