import type { Editor, Range } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";

// 本文中の record 参照ノード。type 名と attrs 形は @plyrs/metamodel の
// extractBodyRelations との契約(apps/admin/src/lib/mention-contract.test.ts が一致を固定)。
export const RECORD_MENTION_NODE_NAME = "recordMention";

export interface RichTextMentionItem {
  /** record id(UUID) */
  id: string;
  /** content type key */
  type: string;
  /** 表示名(挿入時点のスナップショット。真実源は relations 側 — design-spec §5) */
  label: string;
}

export interface MentionSuggestState {
  items: RichTextMentionItem[];
  select: (item: RichTextMentionItem) => void;
}

// エディタコンポーネント(React)側と suggestion プラグイン(ProseMirror)側の接着面。
// candidates は編集中に増減するため getter で最新を引く。
export interface MentionGlue {
  getCandidates: () => RichTextMentionItem[];
  onState: (state: MentionSuggestState | null) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const MAX_MENTION_ITEMS = 8;

function toSuggestState(props: SuggestionProps): MentionSuggestState {
  // SuggestionProps の generic は Mention.configure 経由では any に落ちる。items は
  // 下の items() が返した値そのものなので RichTextMentionItem[] に狭めてよい(境界 cast)。
  const items = props.items as RichTextMentionItem[];
  return { items, select: (item) => props.command(item) };
}

function insertRecordMention(editor: Editor, range: Range, props: unknown): void {
  // props は select() → suggestion command 経由で渡ってきた items() の要素(境界 cast)
  const item = props as RichTextMentionItem;
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      {
        type: RECORD_MENTION_NODE_NAME,
        attrs: { recordType: item.type, recordId: item.id, label: item.label },
      },
      { type: "text", text: " " },
    ])
    .run();
}

export function createRecordMention(glue: MentionGlue) {
  return Mention.extend({
    name: RECORD_MENTION_NODE_NAME,
    addAttributes() {
      return {
        recordType: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-record-type") ?? "",
        },
        recordId: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-record-id") ?? "",
        },
        label: {
          default: "",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-label") ?? "",
        },
      };
    },
  }).configure({
    renderText({ node }) {
      return `@${String(node.attrs["label"] ?? "")}`;
    },
    // StyleX は ProseMirror が生成する DOM に届かないため inline style で逃がす
    // (tech-selection §1.3 の「動的スタイルは inline」規約)。
    renderHTML({ node }) {
      return [
        "span",
        {
          // 継承 parseHTML(span[data-type="recordMention"])と一致させ、コピペ往復を成立させる
          "data-type": RECORD_MENTION_NODE_NAME,
          "data-record-mention": "",
          "data-record-type": String(node.attrs["recordType"] ?? ""),
          "data-record-id": String(node.attrs["recordId"] ?? ""),
          "data-label": String(node.attrs["label"] ?? ""),
          style: "background: rgba(37, 99, 235, 0.14); border-radius: 4px; padding: 0 2px;",
        },
        `@${String(node.attrs["label"] ?? "")}`,
      ];
    },
    suggestion: {
      char: "@",
      items: ({ query }) => {
        const needle = query.toLowerCase();
        return glue
          .getCandidates()
          .filter((item) => item.label.toLowerCase().includes(needle))
          .slice(0, MAX_MENTION_ITEMS);
      },
      command: ({ editor, range, props }) => {
        insertRecordMention(editor, range, props);
      },
      render: () => ({
        onStart: (props: SuggestionProps) => glue.onState(toSuggestState(props)),
        onUpdate: (props: SuggestionProps) => glue.onState(toSuggestState(props)),
        onKeyDown: (props: SuggestionKeyDownProps) => glue.onKeyDown(props.event),
        onExit: () => glue.onState(null),
      }),
    },
  });
}
