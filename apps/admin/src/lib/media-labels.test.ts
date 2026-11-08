import { describe, expect, it } from "vitest";
import { MEDIA_LABELS } from "./media-labels";
import { MEDIA_KINDS } from "./media-kind";

describe("media-labels", () => {
  it("メディアの種類の文言が MEDIA_KINDS と all を網羅する", () => {
    expect(Object.keys(MEDIA_LABELS.kinds).toSorted()).toEqual([...MEDIA_KINDS, "all"].toSorted());
  });
});
