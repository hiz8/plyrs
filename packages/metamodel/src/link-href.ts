import type { ContentTypeDefinition } from "./content-type";
import { richTextEnvelopeSchema, type RichTextNode } from "./record-schema";

// リッチテキストのリンク(mark の attrs.href)に許す scheme。M4 でエージェントが本文を書けるように
// なったので、javascript: / data: / vbscript: などのリンクを書き込み時に拒否する(公開 API の JSON を
// 自前で HTML に描画するフロントエンドで XSS にならないように)。本文中の record 参照と画像は
// リンクではなくノード(recordMention / assetImage)なので、ここには含まれない。
// scheme の無いもの(相対 URL・パス・アンカー・クエリ)は許す。
// 一覧は管理画面のエディタ(Tiptap の link の既定の許可リスト)に揃える。エディタも同じ isSafeLinkHref で
// 判定するので(packages/ui の rich-text-editor.tsx)、エディタで付けたリンクがサーバーで拒否されることはない
export const ALLOWED_LINK_SCHEMES: readonly string[] = [
  "http",
  "https",
  "ftp",
  "ftps",
  "mailto",
  "tel",
  "callto",
  "sms",
  "cid",
  "xmpp",
];

// WHATWG URL の解析と同じく、前後の C0 制御文字と空白を落とし、タブと改行を中から取り除いてから
// scheme を見る(`java\tscript:` や先頭の空白で検査をすり抜けさせない)。scheme は大文字小文字を区別しない
export function isSafeLinkHref(href: string): boolean {
  // oxlint-disable-next-line no-control-regex
  const normalized = href.replaceAll(/^[\u0000- ]+|[\u0000- ]+$/g, "").replaceAll(/[\t\n\r]/g, "");
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalized)?.[1];
  if (scheme === undefined) {
    // scheme が無い。ただし残った制御文字は認めない(ブラウザによって解釈が揺れる)
    // oxlint-disable-next-line no-control-regex
    return !/[\u0000-\u001f\u007f]/.test(normalized);
  }
  return ALLOWED_LINK_SCHEMES.includes(scheme.toLowerCase());
}

// 文書の中の、許さない href を持つ mark の href を出現順に返す
export function unsafeLinkHrefs(node: RichTextNode): string[] {
  const found: string[] = [];
  const visit = (current: RichTextNode) => {
    for (const mark of current.marks ?? []) {
      const href = mark.attrs?.["href"];
      if (href !== undefined && (typeof href !== "string" || !isSafeLinkHref(href))) {
        found.push(String(href));
      }
    }
    for (const child of current.content ?? []) {
      visit(child);
    }
  };
  visit(node);
  return found;
}

export interface UnsafeLink {
  fieldKey: string;
  href: string;
}

// validate-on-write(write-record.ts)が使う。richtext フィールドの許さない href のうち、今の値に
// 無かったものだけを返す。既に保存された値に含まれる href は巻き込まない(この検査より前に保存された
// record が、タイトルなど本文以外を直しても保存できなくなるのを避ける)。判定は型定義で行い、
// エンベロープとして解釈できない値は見ない(形の検証は buildRecordInputSchema が済ませている)
export function newUnsafeLinks(
  definition: Pick<ContentTypeDefinition, "fields">,
  input: Record<string, unknown>,
  current: Record<string, unknown> | null,
): UnsafeLink[] {
  const found: UnsafeLink[] = [];
  for (const field of definition.fields) {
    if (field.type !== "richtext") {
      continue;
    }
    const next = richTextEnvelopeSchema.safeParse(input[field.key]);
    if (!next.success) {
      continue;
    }
    const hrefs = unsafeLinkHrefs(next.data.doc);
    if (hrefs.length === 0) {
      continue;
    }
    const before = richTextEnvelopeSchema.safeParse(current?.[field.key]);
    const kept = new Set(before.success ? unsafeLinkHrefs(before.data.doc) : []);
    for (const href of hrefs) {
      if (!kept.has(href)) {
        found.push({ fieldKey: field.key, href });
      }
    }
  }
  return found;
}
