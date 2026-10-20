import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  SquareCode,
  type LucideIcon,
} from "lucide-react";
import { FieldErrorText } from "./field";
import { ICON_SIZE } from "./icon";
import {
  bg,
  border,
  elevation,
  focus,
  font,
  radius,
  size,
  space,
  stroke,
  text,
} from "./semantic.stylex";
import { Tooltip } from "./tooltip";
import {
  createRecordMention,
  type MentionGlue,
  type MentionSuggestState,
  type RichTextMentionItem,
} from "./record-mention";
import { ASSET_IMAGE_NODE_NAME, createAssetImage, type AssetUrlResolver } from "./asset-image";

// D1 ボード 3b: 外枠に入力欄と同じ枠線と角丸、ツールバーはゴーストのアイコンボタン、
// フォーカスのリングは外枠全体に付ける
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: space.sm, fontFamily: font.family },
  label: { fontSize: font.body, fontWeight: font.weightMedium, color: text.default },
  frame: {
    backgroundColor: bg.canvas,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.control,
    outlineStyle: { default: "none", ":focus-within": "solid" },
    outlineWidth: stroke.focus,
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  // 閲覧者向け: 枠線を外して下罫線だけにする
  frameReadOnly: {
    backgroundColor: "transparent",
    borderTopWidth: 0,
    borderInlineWidth: 0,
    borderBottomWidth: stroke.default,
    borderRadius: 0,
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.xxs,
    padding: space.xs,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  separator: {
    alignSelf: "stretch",
    width: stroke.default,
    marginInline: space.xs,
    backgroundColor: border.default,
  },
  toolButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlSm,
    height: size.controlSm,
    color: text.muted,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: radius.button,
    cursor: "pointer",
    outline: "none",
  },
  toolHovered: { backgroundColor: bg.hover, color: text.default },
  toolButtonActive: { backgroundColor: bg.pressed, color: text.default },
  toolFocus: {
    outlineWidth: stroke.focus,
    outlineStyle: "solid",
    outlineColor: focus.ring,
    outlineOffset: stroke.focus,
  },
  linkPanel: {
    display: "flex",
    gap: space.sm,
    alignItems: "flex-end",
    padding: space.sm,
    borderBottomWidth: stroke.default,
    borderBottomStyle: "solid",
    borderBottomColor: border.default,
  },
  content: { fontSize: font.body, color: text.default },
  mentionList: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "320px",
    padding: space.xs,
    backgroundColor: bg.raised,
    borderWidth: stroke.default,
    borderStyle: "solid",
    borderColor: border.default,
    borderRadius: radius.container,
    boxShadow: elevation.menu,
  },
  mentionOption: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.sm,
    minHeight: size.control,
    paddingInline: space.inset,
    borderRadius: radius.item,
    cursor: "pointer",
  },
  mentionOptionActive: { backgroundColor: bg.hover },
  mentionType: { fontSize: font.caption, color: text.muted },
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
  /** 本文中 record 参照(@)の候補。省略時は mention 候補なし(ノード自体は常に有効) */
  mentionCandidates?: RichTextMentionItem[] | undefined;
  errorMessage?: string | undefined;
  /**
   * プログラマティック制御・テスト用の口。jsdom は contenteditable へのタイピングを再現
   * できないため、テストはここで捕まえた editor へのコマンド駆動で行う(コマンドはキー入力と
   * 同じ transaction dispatch を通る — 6b の隠しネイティブ select と同型の判断)。
   */
  onEditorReady?: ((editor: Editor) => void) | undefined;
  /**
   * ツールバーの「画像」ボタン。押されると insert コールバックを渡して呼ばれる —
   * 呼び出し側(admin)がアセット選択 UI を開き、確定時に insert({id, label}) を呼ぶ。
   * 省略時はボタン非表示(ノード自体は常に登録される — 語彙進化の制約)。
   */
  onRequestAssetImage?:
    | ((insert: (item: { id: string; label: string }) => void) => void)
    | undefined;
  /** 本文中画像のプレビュー URL 解決(認証付き fetch → objectURL)。省略時は src なし表示 */
  resolveAssetUrl?: AssetUrlResolver | undefined;
  /** 閲覧者向け。編集不可・ツールバー無し・下罫線だけ(onRequestAssetImage は無視) */
  isReadOnly?: boolean | undefined;
}

export function RichTextEditor({
  label,
  value,
  onChange,
  mentionCandidates,
  errorMessage,
  onEditorReady,
  onRequestAssetImage,
  resolveAssetUrl,
  isReadOnly,
}: RichTextEditorProps) {
  // useEditor のオプションは初回マウントで確定する(deps [])。以降に変わりうる
  // コールバックは ref 経由で最新を参照する。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;
  const candidatesRef = useRef<RichTextMentionItem[]>(mentionCandidates ?? []);
  candidatesRef.current = mentionCandidates ?? [];
  const onRequestAssetImageRef = useRef(onRequestAssetImage);
  onRequestAssetImageRef.current = onRequestAssetImage;
  const resolveAssetUrlRef = useRef(resolveAssetUrl);
  resolveAssetUrlRef.current = resolveAssetUrl;

  interface SuggestView extends MentionSuggestState {
    index: number;
  }
  const [suggest, setSuggest] = useState<SuggestView | null>(null);
  const suggestRef = useRef<SuggestView | null>(null);
  suggestRef.current = suggest;

  // glue は useEditor(deps [])に渡すため生成は 1 回。最新状態は ref 経由で読む。
  const glue = useMemo<MentionGlue>(
    () => ({
      getCandidates: () => candidatesRef.current,
      onState: (state) =>
        setSuggest(state === null ? null : { items: state.items, select: state.select, index: 0 }),
      onKeyDown: (event) => {
        const current = suggestRef.current;
        if (current === null || current.items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          setSuggest({ ...current, index: (current.index + 1) % current.items.length });
          return true;
        }
        if (event.key === "ArrowUp") {
          setSuggest({
            ...current,
            index: (current.index - 1 + current.items.length) % current.items.length,
          });
          return true;
        }
        if (event.key === "Enter") {
          const item = current.items[current.index];
          if (item !== undefined) {
            current.select(item);
          }
          return true;
        }
        if (event.key === "Escape") {
          setSuggest(null);
          return true;
        }
        return false;
      },
    }),
    [],
  );

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: { openOnClick: false },
        }),
        createRecordMention(glue),
        createAssetImage(() => resolveAssetUrlRef.current),
      ],
      content: docContent(value),
      editable: isReadOnly !== true,
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
          style: "outline: none; min-height: 120px; padding: 12px 16px; line-height: 1.75;",
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

  // useEditor のオプションは初回で確定するため、読み取り専用の切り替えは setEditable で反映する
  useEffect(() => {
    if (editor !== null && editor.isEditable === (isReadOnly === true)) {
      editor.setEditable(isReadOnly !== true);
    }
  }, [editor, isReadOnly]);

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
      <div {...stylex.props(styles.frame, isReadOnly === true && styles.frameReadOnly)}>
        {isReadOnly !== true && (
          <Toolbar
            editor={editor}
            label={label}
            onRequestAssetImage={
              onRequestAssetImage === undefined
                ? undefined
                : () =>
                    onRequestAssetImageRef.current?.((item) => {
                      editor
                        .chain()
                        .focus()
                        .insertContent([
                          {
                            type: ASSET_IMAGE_NODE_NAME,
                            attrs: { recordType: "asset", recordId: item.id, label: item.label },
                          },
                        ])
                        .run();
                    })
            }
          />
        )}
        <EditorContent editor={editor} {...stylex.props(styles.content)} />
      </div>
      {suggest !== null && suggest.items.length > 0 && (
        <div role="listbox" aria-label="record 参照の候補" {...stylex.props(styles.mentionList)}>
          {suggest.items.map((item, index) => (
            <div
              key={`${item.type}${item.id}`}
              role="option"
              aria-selected={index === suggest.index}
              {...stylex.props(
                styles.mentionOption,
                index === suggest.index && styles.mentionOptionActive,
              )}
              // click で確定する前にエディタがフォーカス喪失で suggestion を閉じないよう
              // mousedown を抑止してから click で確定する
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => suggest.select(item)}
            >
              <span>{item.label}</span>
              <span {...stylex.props(styles.mentionType)}>{item.type}</span>
            </div>
          ))}
        </div>
      )}
      {errorMessage !== undefined && <FieldErrorText>{errorMessage}</FieldErrorText>}
    </div>
  );
}

function Toolbar({
  editor,
  label,
  onRequestAssetImage,
}: {
  editor: Editor;
  label: string;
  onRequestAssetImage?: (() => void) | undefined;
}) {
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
          label="見出し1"
          icon={Heading1}
          isActive={active.heading1}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        />
        <ToolbarToggle
          label="見出し2"
          icon={Heading2}
          isActive={active.heading2}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarToggle
          label="見出し3"
          icon={Heading3}
          isActive={active.heading3}
          onToggle={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarSeparator />
        <ToolbarToggle
          label="太字"
          icon={Bold}
          isActive={active.bold}
          onToggle={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarToggle
          label="斜体"
          icon={Italic}
          isActive={active.italic}
          onToggle={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarToggle
          label="コード"
          icon={Code}
          isActive={active.code}
          onToggle={() => editor.chain().focus().toggleCode().run()}
        />
        <ToolbarSeparator />
        <ToolbarToggle
          label="箇条書き"
          icon={List}
          isActive={active.bulletList}
          onToggle={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarToggle
          label="番号リスト"
          icon={ListOrdered}
          isActive={active.orderedList}
          onToggle={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarToggle
          label="引用"
          icon={Quote}
          isActive={active.blockquote}
          onToggle={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarToggle
          label="コードブロック"
          icon={SquareCode}
          isActive={active.codeBlock}
          onToggle={() => editor.chain().focus().toggleCodeBlock().run()}
        />
        <ToolbarSeparator />
        <ToolbarToggle
          label="リンク"
          icon={LinkIcon}
          isActive={active.link}
          onToggle={openLinkPanel}
        />
        {onRequestAssetImage !== undefined && (
          <ToolbarToggle
            label="画像"
            icon={ImageIcon}
            isActive={false}
            onToggle={onRequestAssetImage}
          />
        )}
      </div>
      {linkOpen && (
        <div {...stylex.props(styles.linkPanel)}>
          <TextField label="リンクURL" value={linkHref} onChange={setLinkHref} />
          <Button variant="secondary" size="sm" onPress={applyLink}>
            適用
          </Button>
          <Button variant="secondary" size="sm" onPress={() => setLinkOpen(false)}>
            閉じる
          </Button>
        </div>
      )}
    </>
  );
}

function ToolbarToggle({
  label,
  icon: Icon,
  isActive,
  onToggle,
}: {
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip content={label}>
      <RacToggleButton
        aria-label={label}
        isSelected={isActive}
        onChange={onToggle}
        className={stylexRenderProps<ToggleButtonRenderProps>((state) => [
          styles.toolButton,
          state.isHovered && styles.toolHovered,
          state.isSelected && styles.toolButtonActive,
          state.isFocusVisible && styles.toolFocus,
        ])}
      >
        <Icon size={ICON_SIZE.inline} aria-hidden="true" />
      </RacToggleButton>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <span role="separator" aria-orientation="vertical" {...stylex.props(styles.separator)} />;
}
