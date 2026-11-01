# richtext-spike(M0-2 の試作。main にはマージしない)

論点 A1(リッチテキストの形式)を決めるための試作。結果の正本は
`docs/superpowers/plans/2026-11-01-m0-2-richtext-spike-result.md`(main)と design-spec の決定ログ。

```bash
pnpm --filter @plyrs/richtext-spike test        # 全試作(RESULTS.md / RESULTS-markdown-input.md を再生成)
pnpm --filter @plyrs/richtext-spike typecheck
```

| ファイル | 内容 |
| --- | --- |
| `src/block-ids.ts` / `.test.ts` | v1 を読むときの最上位ブロック ID の決定的な導出(位置 + 内容のハッシュ)、保存 ID の優先、重複の解消 |
| `src/unique-id.test.ts` | `@tiptap/extension-unique-id` 3.31.4 の挙動(初期付与・ペースト時の重複解消・insertContent の重複) |
| `src/fixtures.ts` | StarterKit(見出し 1-3)+ recordMention + assetImage の全ノード種・全マーク種 19 件 |
| `src/portable-text.ts` | Tiptap JSON ⇄ Portable Text(HTML 経由: static-renderer → @portabletext/html → @portabletext/to-html → @tiptap/html) |
| `src/markdown.ts` | Tiptap JSON ⇄ Markdown(`@tiptap/markdown` の MarkdownManager を Editor 無し・DOM 無しで使う) |
| `src/fidelity.test.ts` | 19 件の往復と差分の一覧 → `RESULTS.md` |
| `src/markdown-input.test.ts` | スキーマ外の Markdown を受けたときの挙動 → `RESULTS-markdown-input.md` |
