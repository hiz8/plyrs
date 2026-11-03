import type { RichTextNode } from "./record-schema";

// リッチテキストのリンク(mark の attrs.href)に許す scheme。M4 でエージェントが本文を書けるように
// なったので、javascript: / data: / vbscript: などのリンクを書き込み時に拒否する(公開 API の JSON を
// 自前で HTML に描画するフロントエンドで XSS にならないように)。本文中の record 参照と画像は
// リンクではなくノード(recordMention / assetImage)なので、ここには含まれない。
// scheme の無いもの(相対 URL・パス・アンカー・クエリ)は許す。
export const ALLOWED_LINK_SCHEMES: readonly string[] = ["http", "https", "mailto", "tel"];

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
