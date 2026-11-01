# スキーマ外の Markdown の受け入れ(自動生成: src/markdown-input.test.ts)

| 入力 | Markdown | 得られた AST(content) | スキーマ検証 | 再出力 |
| --- | --- | --- | --- | --- |
| h4(語彙は h1〜h3) | `#### 深い見出し` | `[{"type":"heading","attrs":{"level":4},"content":[{"type":"text","text":"深い見出し"}]}]` | スキーマ検証 OK | `#### 深い見出し` |
| GFM テーブル | `\| a \| b \|\n\| --- \| --- \|\n\| 1 \| 2 \|` | `[]` | スキーマ検証 NG: Invalid content for node doc: <> | `` |
| タスクリスト | `- [ ] todo\n- [x] done` | `[{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"text","text":"todo"}]},{"type":"listItem","content":[{"type":"text","text":"done"}]}]}]` | スキーマ検証 NG: Invalid content for node listItem: <"todo"> | `- todo\n- done` |
| 外部 URL の画像 | `![alt](https://example.com/x.png)` | `[{"type":"text","text":"alt"}]` | スキーマ検証 NG: Invalid content for node doc: <"alt"> | `alt` |
| 生の HTML ブロック | `<div class="x">html</div>` | `[{"type":"paragraph","content":[{"type":"text","text":"<div class=\"x\">html</div>"}]}]` | スキーマ検証 OK | `&lt;div class="x"&gt;html&lt;/div&gt;` |
| 生のインライン HTML | `a <b>b</b> c` | `[{"type":"paragraph","content":[{"type":"text","text":"a <b>b</b> c"}]}]` | スキーマ検証 OK | `a &lt;b&gt;b&lt;/b&gt; c` |
| 脚注・自動リンク | `see https://example.com and [^1]\n\n[^1]: note` | `[{"type":"paragraph","content":[{"type":"text","text":"see "},{"type":"text","text":"https://example.com","marks":[{"type":"link","attrs":{"href":"https://example.com","title":null}}]},{"type":"text","text":" and "},{"type":"text","text":"^1","marks":[{"type":"link","attrs":{"href":"note","title":null}}]}]}]` | スキーマ検証 OK | `see [https://example.com](https://example.com) and [^1](note)` |
| 空文字 | `` | `[]` | スキーマ検証 NG: Invalid content for node doc: <> | `` |
| 見出しの直後に続く段落(空行なし) | `# 題\n本文` | `[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"題"}]},{"type":"paragraph","content":[{"type":"text","text":"本文"}]}]` | スキーマ検証 OK | `# 題\n\n本文` |
| 番号リスト 3 から | `3. 三\n4. 四` | `[{"type":"orderedList","attrs":{"start":3},"content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"三"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"四"}]}]}]}]` | スキーマ検証 OK | `3. 三\n4. 四` |
| ネストした引用 | `> 外\n>\n> > 内` | `[{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"外"}]},{"type":"blockquote","content":[{"type":"paragraph","content":[{"type":"text","text":"内"}]}]}]}]` | スキーマ検証 OK | `> 外\n>\n> > 内` |