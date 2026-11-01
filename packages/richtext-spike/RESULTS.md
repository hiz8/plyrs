# 変換忠実度の結果(自動生成: src/fidelity.test.ts)

○ = 往復で意味が同じ(ブロック ID と null の attrs は無視)、× = 不可逆。差分は最初の数件。

| ノード種 | 説明 | (a) PM JSON + id | (b) Portable Text | (c) Markdown |
| --- | --- | --- | --- | --- |
| paragraph | 段落 | ○ | ○ | ○ |
| heading | 見出し 1〜3 | ○ | ○ | ○ |
| marks | 太字・斜体・取り消し線・下線・インラインコード | ○ | ○ | ○ |
| marks-nested | 重ねたマーク(太字 + 斜体 + リンク) | ○ | ○ | ○ |
| link | 外部リンク(href・target・rel) | ○ | ○ | ○ |
| bulletList | 箇条書き(2 階層の入れ子) | ○ | ○ | ○ |
| orderedList-start | 番号リスト(start=3) | ○ | ×<br>`doc.orderedList[0]: attrs {"start":3} → {"start":1}` | ○ |
| listItem-multi-paragraph | 1 つの項目に 2 段落 | ○ | ×<br>`doc.bulletList[0].listItem[0]: 子の数 2 → 1(paragraph)` | ○ |
| blockquote | 引用(段落 2 つ) | ○ | ×<br>`doc.blockquote[0]: 子の数 2 → 1(paragraph)` | ○ |
| blockquote-nested-list | 引用の中の箇条書き | ○ | ×<br>`doc: 子の数 1 → 2(blockquote,bulletList)` | ○ |
| codeBlock | コードブロック(language 付き、複数行) | ○ | ○ | ○ |
| codeBlock-no-language | コードブロック(language 無し、Markdown 風の記号を含む) | ○ | ○ | ○ |
| hardBreak | 段落内の改行 | ○ | ○ | ○ |
| horizontalRule | 区切り線 | ○ | ○ | ○ |
| recordMention | 本文中の record 参照(インライン独自ノード) | ○ | ○ | ○ |
| assetImage | 本文中の画像(ブロック独自ノード) | ○ | ○ | ○ |
| empty-paragraphs | 空段落の連続(エディタで Enter を連打した状態) | ○ | ○ | ○ |
| markdown-special-chars | Markdown の記号を含む平文(* _ ` # [ ] < >) | ○ | ○ | ○ |
| whitespace | 先頭・末尾・連続の空白 | ○ | ×<br>`doc.paragraph[0].text[0]: text "  前  中  後  " → "前 中 後"` | ○ |

## Markdown 出力(@tiptap/markdown の serialize)

### paragraph

```markdown
本文です。
```
(static-renderer の renderToMarkdown とは不一致)

### heading

```markdown
# 見出し1

## 見出し2

### 見出し3
```
(static-renderer の renderToMarkdown とは不一致)

### marks

```markdown
**太字***斜体*~~取り消し~~++下線++`code`
```
(static-renderer の renderToMarkdown とは不一致)

### marks-nested

```markdown
[***重ね***](https://example.com/a)
```
(static-renderer の renderToMarkdown とは不一致)

### link

```markdown
[リンク](https://example.com/?a=1&b=2)
```
(static-renderer の renderToMarkdown とは不一致)

### bulletList

```markdown
- 一
- 二
  - 二の一
```
(static-renderer の renderToMarkdown とは不一致)

### orderedList-start

```markdown
3. 三
4. 四
```
(static-renderer の renderToMarkdown とは不一致)

### listItem-multi-paragraph

```markdown
- 前半

  後半
```
(static-renderer の renderToMarkdown とは不一致)

### blockquote

```markdown
> 一文目
>
> 二文目
```
(static-renderer の renderToMarkdown とは不一致)

### blockquote-nested-list

```markdown
> 前置き
>
> - 項目
```
(static-renderer の renderToMarkdown とは不一致)

### codeBlock

```markdown
```ts
const a = 1;
console.log(a);
```
```
(static-renderer の renderToMarkdown とは不一致)

### codeBlock-no-language

```markdown
```
# not a heading
* not a list
```
```
(static-renderer の renderToMarkdown とは不一致)

### hardBreak

```markdown
一行目  
二行目
```
(static-renderer の renderToMarkdown とは不一致)

### horizontalRule

```markdown
前

---

後
```
(static-renderer の renderToMarkdown とは不一致)

### recordMention

```markdown
著者は [@ recordType="author" recordId="018f2b6a-7a0a-7000-8000-000000000001" label="山田"] です
```
(static-renderer の renderToMarkdown とは不一致)

### assetImage

```markdown
図:

![hero.png](plyrs://asset/018f2b6a-7a0a-7000-8000-000000000002)

以上
```
(static-renderer の renderToMarkdown とは不一致)

### empty-paragraphs

```markdown
前



&nbsp;

後
```
(static-renderer の renderToMarkdown とは不一致)

### markdown-special-chars

```markdown
a\*b\_c\`d#e\[f\]&lt;g&gt;h
```
(static-renderer の renderToMarkdown とは不一致)

### whitespace

```markdown
  前  中  後  
```
(static-renderer の renderToMarkdown とは不一致)
