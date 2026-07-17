import { describe, expect, it } from "vitest";
import { RECORD_MENTION_NODE_TYPE } from "@plyrs/metamodel";
import { RECORD_MENTION_NODE_NAME } from "@plyrs/ui";

// エディタ(ui)が書くノード名と、DO 側抽出(metamodel)が読むノード名の契約を固定する。
// どちらかを変えるときは両方を同時に変え、このテストで一致を確かめること。
describe("record mention contract", () => {
  it("ui node name matches the metamodel extraction target", () => {
    expect(RECORD_MENTION_NODE_NAME).toBe(RECORD_MENTION_NODE_TYPE);
  });
});
