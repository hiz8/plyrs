import { Cell, Column, Row, Table, TableBody, TableHeader } from "@plyrs/ui";

const files = [
  { id: "1", name: "hero.jpg", size: "2.4 MB", updated: "10 分前" },
  { id: "2", name: "ロゴ.svg", size: "12 KB", updated: "昨日" },
  { id: "3", name: "会場マップ.png", size: "860 KB", updated: "3 日前" },
];

const body = (
  <TableBody items={files}>
    {(f) => (
      <Row id={f.id}>
        <Cell>{f.name}</Cell>
        <Cell>{f.size}</Cell>
        <Cell>{f.updated}</Cell>
      </Row>
    )}
  </TableBody>
);

export const Plain = () => (
  <div style={{ width: 520 }}>
    <Table aria-label="メディア">
      <TableHeader>
        <Column id="name" isRowHeader>
          ファイル名
        </Column>
        <Column id="size">サイズ</Column>
        <Column id="updated">更新</Column>
      </TableHeader>
      {body}
    </Table>
  </div>
);

export const SortableUnsorted = () => (
  <div style={{ width: 520 }}>
    <Table aria-label="メディア">
      <TableHeader>
        <Column id="name" isRowHeader allowsSorting>
          ファイル名
        </Column>
        <Column id="size" allowsSorting>
          サイズ
        </Column>
        <Column id="updated" allowsSorting>
          更新
        </Column>
      </TableHeader>
      {body}
    </Table>
  </div>
);

export const SortedAscending = () => (
  <div style={{ width: 520 }}>
    <Table aria-label="メディア" sortDescriptor={{ column: "name", direction: "ascending" }}>
      <TableHeader>
        <Column id="name" isRowHeader allowsSorting>
          ファイル名
        </Column>
        <Column id="size" allowsSorting>
          サイズ
        </Column>
        <Column id="updated">更新</Column>
      </TableHeader>
      {body}
    </Table>
  </div>
);

export const SortedDescending = () => (
  <div style={{ width: 520 }}>
    <Table aria-label="メディア" sortDescriptor={{ column: "updated", direction: "descending" }}>
      <TableHeader>
        <Column id="name" isRowHeader allowsSorting>
          ファイル名
        </Column>
        <Column id="size">サイズ</Column>
        <Column id="updated" allowsSorting>
          更新
        </Column>
      </TableHeader>
      {body}
    </Table>
  </div>
);
