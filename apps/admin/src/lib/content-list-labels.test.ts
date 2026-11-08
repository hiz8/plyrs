import { describe, expect, it } from "vitest";
import { LIST_TABS } from "./list-tab";
import { LIST_LABELS } from "./content-list-labels";

describe("content-list-labels", () => {
  it("一覧のタブ文言が LIST_TABS を網羅する", () => {
    expect(Object.keys(LIST_LABELS.tabs).toSorted()).toEqual(LIST_TABS.toSorted());
  });
});
