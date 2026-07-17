import { Node } from "@tiptap/core";

// 本文中の画像埋め込みノード。type 名と attrs 形は @plyrs/metamodel の ASSET_IMAGE_NODE_TYPE /
// extractBodyRelations との契約(apps/admin/src/lib/mention-contract.test.ts が一致を固定)。
// attrs は mention と同型 {recordType, recordId, label} — label は挿入時点の filename
// スナップショット(エディタ表示専用。真実源は asset record — design-spec §5)。
export const ASSET_IMAGE_NODE_NAME = "assetImage";

// 管理画面のプレビュー URL は認証付き fetch → objectURL でしか得られないため非同期。
// null = 解決不能(プレースホルダー表示のまま)。
export type AssetUrlResolver = (recordId: string) => Promise<string | null>;

function attr(node: { attrs: Record<string, unknown> }, name: string): string {
  return String(node.attrs[name] ?? "");
}

export function createAssetImage(getResolver: () => AssetUrlResolver | undefined) {
  return Node.create({
    name: ASSET_IMAGE_NODE_NAME,
    group: "block",
    atom: true,
    addAttributes() {
      return {
        recordType: {
          default: "asset",
          parseHTML: (element: HTMLElement) => element.getAttribute("data-record-type") ?? "asset",
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
    parseHTML() {
      return [{ tag: `img[data-type="${ASSET_IMAGE_NODE_NAME}"]` }];
    },
    // StyleX は ProseMirror が生成する DOM に届かないため inline style で逃がす
    // (tech-selection §1.3 の規約 — record-mention.ts と同じ判断)。
    renderHTML({ node }) {
      return [
        "img",
        {
          "data-type": ASSET_IMAGE_NODE_NAME,
          "data-record-type": attr(node, "recordType"),
          "data-record-id": attr(node, "recordId"),
          "data-label": attr(node, "label"),
          alt: attr(node, "label"),
          style: "max-width: 100%;",
        },
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const img = document.createElement("img");
        img.setAttribute("data-type", ASSET_IMAGE_NODE_NAME);
        img.setAttribute("data-record-type", attr(node, "recordType"));
        img.setAttribute("data-record-id", attr(node, "recordId"));
        img.setAttribute("data-label", attr(node, "label"));
        img.setAttribute("alt", attr(node, "label"));
        img.setAttribute("style", "max-width: 100%; min-height: 24px; display: block;");
        const resolver = getResolver();
        if (resolver !== undefined) {
          // 解決完了時に nodeView が破棄済みでも属性セットは無害(detached DOM への書き込み)
          void resolver(attr(node, "recordId")).then((url) => {
            if (url !== null) {
              img.setAttribute("src", url);
            }
          });
        }
        return { dom: img };
      };
    },
  });
}
