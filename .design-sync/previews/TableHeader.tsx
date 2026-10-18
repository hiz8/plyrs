import { Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const events = [
  { id: "1", name: "春の収穫祭", place: "中央広場", date: "4/12" },
  { id: "2", name: "夏の星空観察会", place: "北の丘公園", date: "7/20" },
  { id: "3", name: "秋の写真展", place: "市民ギャラリー", date: "10/5" },
];

export const PlainHeader = () => (
  <div style={{ width: 560 }}>
    <Table aria-label="イベント">
      <TableHeader>
        <Column id="name" isRowHeader>
          イベント名
        </Column>
        <Column id="place">会場</Column>
        <Column id="date">開催日</Column>
      </TableHeader>
      <TableBody items={events}>
        {(e) => (
          <Row id={e.id}>
            <Cell>{e.name}</Cell>
            <Cell>{e.place}</Cell>
            <Cell>{e.date}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);

export const WithSelectAll = () => (
  <div style={{ width: 560 }}>
    <Table aria-label="イベント" selectionMode="multiple" defaultSelectedKeys={["1", "2", "3"]}>
      <TableHeader>
        <Column id="name" isRowHeader>
          イベント名
        </Column>
        <Column id="place">会場</Column>
        <Column id="date">開催日</Column>
      </TableHeader>
      <TableBody items={events}>
        {(e) => (
          <Row id={e.id}>
            <Cell>{e.name}</Cell>
            <Cell>{e.place}</Cell>
            <Cell>{e.date}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);
