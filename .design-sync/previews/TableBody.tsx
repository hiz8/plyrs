import { Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const members = [
  { id: "a", name: "山田 花子", role: "管理者" },
  { id: "b", name: "佐藤 太郎", role: "編集者" },
  { id: "c", name: "鈴木 一郎", role: "閲覧者" },
];

const header = (
  <TableHeader>
    <Column id="name" isRowHeader>
      名前
    </Column>
    <Column id="role">ロール</Column>
  </TableHeader>
);

export const WithRows = () => (
  <div style={{ width: 420 }}>
    <Table aria-label="メンバー">
      {header}
      <TableBody items={members}>
        {(m) => (
          <Row id={m.id}>
            <Cell>{m.name}</Cell>
            <Cell>{m.role}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);

export const Empty = () => (
  <div style={{ width: 420 }}>
    <Table aria-label="メンバー">
      {header}
      <TableBody
        items={[] as typeof members}
        renderEmptyState={() => <div style={{ padding: 24, textAlign: "center" }}>該当するメンバーがいません</div>}
      >
        {(m) => (
          <Row id={m.id}>
            <Cell>{m.name}</Cell>
            <Cell>{m.role}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);
