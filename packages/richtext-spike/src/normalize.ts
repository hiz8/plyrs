import type { JSONContent } from "@tiptap/core";

// 比較用の正規形: ブロック ID と null の attrs を落とし、空の attrs / content を消す。
// 「意味が同じなら等しい」を狙う(ID の有無・既定値の明示は差分と見ない)。
export function normalize(node: JSONContent): JSONContent {
  const out: JSONContent = { type: node.type };
  if (node.attrs) {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.attrs)) {
      if (k === "id" || v === null || v === undefined) continue;
      attrs[k] = v;
    }
    if (Object.keys(attrs).length > 0) out.attrs = attrs;
  }
  if (node.marks && node.marks.length > 0) {
    out.marks = node.marks
      .map((m) => {
        const attrs = Object.fromEntries(
          Object.entries(m.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined),
        );
        return Object.keys(attrs).length > 0 ? { type: m.type, attrs } : { type: m.type };
      })
      .sort((a, b) => a.type.localeCompare(b.type));
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.content && node.content.length > 0) out.content = node.content.map(normalize);
  return out;
}

// 2 つの AST の差分を人が読める 1 行ずつにする(報告書用)。深追いせず、最初の数件だけ返す
export function describeDiff(a: JSONContent, b: JSONContent, path = "doc", out: string[] = []): string[] {
  if (out.length >= 4) return out;
  if (a.type !== b.type) {
    out.push(`${path}: ${a.type} → ${b.type}`);
    return out;
  }
  if (a.text !== b.text) out.push(`${path}: text ${JSON.stringify(a.text)} → ${JSON.stringify(b.text)}`);
  if (JSON.stringify(a.attrs ?? {}) !== JSON.stringify(b.attrs ?? {}))
    out.push(`${path}: attrs ${JSON.stringify(a.attrs ?? {})} → ${JSON.stringify(b.attrs ?? {})}`);
  if (JSON.stringify(a.marks ?? []) !== JSON.stringify(b.marks ?? []))
    out.push(`${path}: marks ${JSON.stringify(a.marks ?? [])} → ${JSON.stringify(b.marks ?? [])}`);
  const ac = a.content ?? [];
  const bc = b.content ?? [];
  if (ac.length !== bc.length) {
    out.push(`${path}: 子の数 ${ac.length} → ${bc.length}(${bc.map((n) => n.type).join(",")})`);
    return out;
  }
  ac.forEach((child, i) => describeDiff(child, bc[i]!, `${path}.${child.type}[${i}]`, out));
  return out;
}
