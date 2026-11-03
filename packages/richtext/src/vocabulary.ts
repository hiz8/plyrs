// M2-2(design-spec 16.10): リッチテキストの語彙。ui のエディタ(packages/ui)・api の Worker・DO の
// 3 か所が同じ定義を引く。ノード名は @plyrs/metamodel の RECORD_MENTION_NODE_TYPE /
// ASSET_IMAGE_NODE_TYPE が正本(抽出側の契約)で、ここはその上に Markdown 文法と属性を足す。

// StarterKit の見出しレベル。エディタのツールバーもこの範囲(見出し 1〜3)
export const HEADING_LEVELS = [1, 2, 3] as const;
export const MAX_HEADING_LEVEL = 3;

// 本文中参照ノード(record 参照・画像)の attrs。label は挿入時点の表示名のスナップショット
// (正本は参照先 record。design-spec §5)
export const REF_ATTRIBUTE_NAMES = ["recordType", "recordId", "label"] as const;

// 本文中画像の Markdown 表現で使う独自スキーム: ![label](plyrs://asset/<uuid>)
export const ASSET_IMAGE_HREF_PREFIX = "plyrs://asset/";

// record 参照の Markdown 表現(Tiptap 公式の inline shortcode):
//   [@ recordType="author" recordId="<uuid>" label="山田"]
export const RECORD_MENTION_MARKDOWN_NAME = "@";

// Markdown → AST で受け付けない構文の種類(design-spec 16.10)。拒否は必ず unsupported_markdown の
// 業務エラーで返し、黙って落とさない。markdown.ts が検出し、extensions.ts の parseMarkdown は
// 検出をすり抜けた場合の最後の砦としてこのエラーを投げる
export type UnsupportedMarkdownKind =
  | "table"
  | "task_list"
  | "external_image"
  | "invalid_structure";

export class UnsupportedMarkdownError extends Error {
  readonly kind: UnsupportedMarkdownKind;
  constructor(kind: UnsupportedMarkdownKind, message: string) {
    super(message);
    this.name = "UnsupportedMarkdownError";
    this.kind = kind;
  }
}
