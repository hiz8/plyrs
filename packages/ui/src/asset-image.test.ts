import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ASSET_IMAGE_NODE_NAME, createAssetImage, type AssetUrlResolver } from "./asset-image";

const ASSET_ID = "018f2b6a-7a0a-7000-8000-0000000000ab";

function makeEditor(resolver?: AssetUrlResolver) {
  return new Editor({
    extensions: [StarterKit, createAssetImage(() => resolver)],
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
}

describe("assetImage node (Phase 8 裁定 5)", () => {
  it("inserts a block node with the mention-shaped attrs", () => {
    const editor = makeEditor();
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    const doc = editor.getJSON();
    const node = doc.content?.find((child) => child.type === ASSET_IMAGE_NODE_NAME);
    expect(node?.attrs).toEqual({ recordType: "asset", recordId: ASSET_ID, label: "hero.png" });
    editor.destroy();
  });

  it("serializes data-* attributes and round-trips through HTML (コピペ往復契約)", () => {
    const editor = makeEditor();
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    const html = editor.getHTML();
    expect(html).toContain(`data-type="${ASSET_IMAGE_NODE_NAME}"`);
    expect(html).toContain(`data-record-id="${ASSET_ID}"`);
    expect(html).toContain('data-record-type="asset"');
    expect(html).toContain('data-label="hero.png"');

    const restored = makeEditor();
    restored.commands.setContent(html);
    const node = restored.getJSON().content?.find((child) => child.type === ASSET_IMAGE_NODE_NAME);
    expect(node?.attrs).toEqual({ recordType: "asset", recordId: ASSET_ID, label: "hero.png" });
    editor.destroy();
    restored.destroy();
  });

  it("resolves the preview src via the resolver (nodeView)", async () => {
    const resolver = vi.fn(async () => "blob:preview-url");
    const editor = makeEditor(resolver);
    editor
      .chain()
      .insertContent([
        {
          type: ASSET_IMAGE_NODE_NAME,
          attrs: { recordType: "asset", recordId: ASSET_ID, label: "hero.png" },
        },
      ])
      .run();
    // nodeView は EditorContent へのマウントなしでも editor.view 経由で生成される(jsdom)。
    await vi.waitFor(() => {
      const img = editor.view.dom.querySelector(`img[data-type="${ASSET_IMAGE_NODE_NAME}"]`);
      expect(img?.getAttribute("src")).toBe("blob:preview-url");
    });
    expect(resolver).toHaveBeenCalledWith(ASSET_ID);
    editor.destroy();
  });
});
