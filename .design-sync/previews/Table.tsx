import { Badge, Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const rows = [
  { id: "1", title: "年末年始の営業について", status: "公開中", tone: "success", updated: "10 分前" },
  { id: "2", title: "秋のキャンペーンのお知らせ", status: "未反映の変更あり", tone: "warning", updated: "3 時間前" },
  { id: "3", title: "新しい店舗がオープンします", status: "未公開", tone: "neutral", updated: "昨日" },
] as const;

export const ContentList = () => (
  <div style={{ width: 640 }}>
    <Table
      aria-label="お知らせ"
      selectionMode="multiple"
      defaultSelectedKeys={["2"]}
      sortDescriptor={{ column: "updated", direction: "descending" }}
    >
      <TableHeader>
        <Column id="title" isRowHeader allowsSorting>
          タイトル
        </Column>
        <Column id="status">公開</Column>
        <Column id="updated" allowsSorting>
          更新
        </Column>
      </TableHeader>
      <TableBody items={rows}>
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.title}</Cell>
            <Cell>
              <Badge tone={row.tone} dot>
                {row.status}
              </Badge>
            </Cell>
            <Cell>{row.updated}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);

export const WithoutSelection = () => (
  <div style={{ width: 480 }}>
    <Table aria-label="メンバー">
      <TableHeader>
        <Column id="name" isRowHeader>
          名前
        </Column>
        <Column id="role">ロール</Column>
      </TableHeader>
      <TableBody
        items={[
          { id: "a", name: "山田 花子", role: "管理者" },
          { id: "b", name: "佐藤 太郎", role: "編集者" },
        ]}
      >
        {(row) => (
          <Row id={row.id}>
            <Cell>{row.name}</Cell>
            <Cell>{row.role}</Cell>
          </Row>
        )}
      </TableBody>
    </Table>
  </div>
);
