import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Editor, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  ToggleButton as RacToggleButton,
  type ToggleButtonRenderProps,
} from "react-aria-components";
import { Button } from "./button";
import { TextField } from "./text-field";
import { stylexRenderProps } from "./compose";
import { colors, spacing, typography } from "./tokens.stylex";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.xs,
    fontFamily: typography.fontFamily,
  },
  label: { fontSize: typography.sizeSm, color: colors.textMuted },
  toolbar: { display: "flex", flexWrap: "wrap", gap: spacing.xs, alignItems: "center" },
  toolButton: {
    fontFamily: typography.fontFamily,
    fontSize: typography.sizeSm,
    paddingBlock: spacing.xs,
    paddingInline: spacing.sm,
    borderRadius: "4px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    cursor: "pointer",
    outline: "none",
  },
  toolButtonActive: {
    backgroundColor: colors.accent,
    color: colors.accentText,
    borderColor: colors.accent,
  },
  toolHovered: { opacity: 0.9 },
  toolFocus: {
    outlineWidth: "2px",
    outlineStyle: "solid",
    outlineColor: colors.focusRing,
    outlineOffset: "1px",
  },
  linkPanel: { display: "flex", gap: spacing.sm, alignItems: "flex-end" },
  content: {
    borderRadius: "6px",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingInline: spacing.md,
    fontSize: typography.sizeMd,
  },
  error: { fontSize: typography.sizeSm, color: colors.danger },
});

// records.data に入る AST エンベロープ(tech-selection 2.7)。doc の構造検証は
// @plyrs/metamodel の richTextEnvelopeSchema が担い、ui は中身に立ち入らない。
export interface RichTextValue {
  schemaVersion: number;
  doc: unknown;
}

export const RICH_TEXT_SCHEMA_VERSION = 1;

const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

// doc は unknown(metamodel 検証済みの AST)。Tiptap の JSONContent への境界 cast は
// 「data JSON の脱出ハッチを 1 箇所に閉じ込める」規約(tech-selection 2.1)の editor 側対応物。
function docContent(value: RichTextValue | undefined): JSONContent {
  return value === undefined ? EMPTY_DOC : (value.doc as JSONContent);
}

export interface RichTextEditorProps {
  label: string;
  /** undefined = 空ドキュメントから開始 */
  value: RichTextValue | undefined;
  onChange: (value: RichTextValue) => void;
  errorMessage?: string | undefined;
  /**
   * プログラマティック制御・テスト用の口。jsdom は contenteditable へのタイピングを再現
   * できないため、テストはここで捕まえた editor へのコマンド駆動で行う(コマンドはキー入力と
   * 同じ transaction dispatch を通る — 6b の隠しネイティブ select と同型の判断)。
   */
  onEditorReady?: ((editor: Editor) => void) | undefined;
}

export function RichTextEditor({
  label,
  value,
  onChange,
  errorMessage,
  onEditorReady,
}: RichTextEditorProps) {
  // useEditor のオプションは初回マウントで確定する(deps [])。以降に変わりうる
  // コールバックは ref 経由で最新を参照する。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
      ],
      content: docContent(value),
      // v3 既定と同じだが明示: transaction ごとに React を再レンダーしない。
      // ツールバーの活性状態は useEditorState が購読する。
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          // TextField と同じ getByRole("textbox", { name: label }) で見つける規約。
          // StyleX は ProseMirror が生成する DOM に届かないため、編集面の最小スタイルは
          // inline で持つ(tech-selection §1.3 の「動的スタイルは inline で逃がす」規約)。
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": label,
          style: "outline: none; min-height: 120px; padding-block: 8px;",
        },
      },
      onUpdate: ({ editor: current }) => {
        onChangeRef.current({
          schemaVersion: RICH_TEXT_SCHEMA_VERSION,
          doc: current.getJSON(),
        });
      },
    },
    [],
  );

  useEffect(() => {
    if (editor !== null) {
      onEditorReadyRef.current?.(editor);
    }
  }, [editor]);

  // 競合解決の「サーバー版を採用」等、外部からの値差し替えを反映する。編集者自身の
  // 変更(onUpdate 由来)は getJSON と一致するため setContent は走らない。
  useEffect(() => {
    if (editor === null || value === undefined) {
      return;
    }
    if (JSON.stringify(value.doc) !== JSON.stringify(editor.getJSON())) {
      editor.commands.setContent(docContent(value), { emitUpdate: false });
    }
  }, [editor, value]);

  if (editor === null) {
    return null;
  }

  return (
    <div {...stylex.props(styles.root)}>
      <span {...stylex.props(styles.label)}>{label}</span>
      <Toolbar editor={editor} label={label} />
      <EditorContent editor={editor} {...stylex.props(styles.content)} />
      {errorMessage !== undefined && <span {...stylex.props(styles.error)}>{errorMessage}</span>}
    </div>
  );
}

function Toolbar({ editor, label }: { editor: Editor; label: string }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkHref, setLinkHref] = useState("");
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      code: current.isActive("code"),
      heading1: current.isActive("heading", { level: 1 }),
      heading2: current.isActive("heading", { level: 2 }),
      heading3: current.isActive("heading", { level: 3 }),
      bulletList: current.isActive("bulletList"),
      orderedList: current.isActive("orderedList"),
      blockquote: current.isActive("blockquote"),
      codeBlock: current.isActive("codeBlock"),
      link: current.isActive("link"),
    }),
  });

  const openLinkPanel = () => {
    const attrs: Record<string, unknown> = editor.getAttributes("link");
    const href = attrs["href"];
    setLinkHref(typeof href === "string" ? href : "");
    setLinkOpen(true);
  };

  const applyLink = () => {
    const href = linkHref.trim();
    if (href === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  };

  return (
    <>
      <div role="toolbar" aria-label={`${label} の書式`} {...stylex.props(styles.toolbar)}>
        <ToolbarToggle
          label="太字"
          isActive={active.bold}
          onToggle={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarToggle>
        <ToolbarToggle
          label="斜体"
          isActive={active.italic}
          onToggle={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </ToolbarToggle>
        <ToolbarToggle
          label="コード"
          isActive={active.code}
          onToggle={() => editor.chain().focus().toggleCode().run()}
        >
          {"</>"}
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し1"
          isActive={active.heading1}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し2"
          isActive={active.heading2}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarToggle>
        <ToolbarToggle
          label="見出し3"
          isActive={active.heading3}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarToggle>
        <ToolbarToggle
          label="箇条書き"
          isActive={active.bulletList}
          onToggle={() => editor.chain().focus().toggleBulletList().run()}
        >
          ・
        </ToolbarToggle>
        <ToolbarToggle
          label="番号リスト"
          isActive={active.orderedList}
          onToggle={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarToggle>
        <ToolbarToggle
          label="引用"
          isActive={active.blockquote}
          onToggle={() => editor.chain().focus().toggleBlockquote().run()}
        >
          "
        </ToolbarToggle>
        <ToolbarToggle
          label="コードブロック"
          isActive={active.codeBlock}
          onToggle={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          {"{ }"}
        </ToolbarToggle>
        <ToolbarToggle label="リンク" isActive={active.link} onToggle={openLinkPanel}>
          🔗
        </ToolbarToggle>
      </div>
      {linkOpen && (
        <div {...stylex.props(styles.linkPanel)}>
          <TextField label="リンクURL" value={linkHref} onChange={setLinkHref} />
          <Button variant="secondary" onPress={applyLink}>
            適用
          </Button>
          <Button variant="secondary" onPress={() => setLinkOpen(false)}>
            閉じる
          </Button>
        </div>
      )}
    </>
  );
}

function ToolbarToggle({
  label,
  isActive,
  onToggle,
  children,
}: {
  label: string;
  isActive: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <RacToggleButton
      aria-label={label}
      isSelected={isActive}
      onChange={onToggle}
      className={stylexRenderProps<ToggleButtonRenderProps>((state) => [
        styles.toolButton,
        state.isSelected && styles.toolButtonActive,
        state.isHovered && styles.toolHovered,
        state.isFocusVisible && styles.toolFocus,
      ])}
    >
      {children}
    </RacToggleButton>
  );
}
