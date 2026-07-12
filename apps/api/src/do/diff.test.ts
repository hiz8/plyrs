import { describe, expect, it } from "vitest";
import type { RelationRef } from "@plyrs/metamodel";
import { splitRecordInput } from "@plyrs/metamodel";
import { computeChangeSet, jsonDeepEqual } from "./diff";
import { articleType, uuid, validArticleInput } from "../../test/fixtures";

describe("jsonDeepEqual", () => {
  it("compares primitives, arrays and objects structurally", () => {
    expect(jsonDeepEqual(1, 1)).toBe(true);
    expect(jsonDeepEqual("a", "b")).toBe(false);
    expect(jsonDeepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(jsonDeepEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonDeepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(jsonDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(jsonDeepEqual(null, undefined)).toBe(false);
    expect(jsonDeepEqual(undefined, undefined)).toBe(true);
  });
});

describe("computeChangeSet", () => {
  const type = articleType();
  const input = validArticleInput();

  function prevRelationsOf(refsInput: Record<string, unknown>): Map<string, RelationRef[]> {
    const map = new Map<string, RelationRef[]>();
    map.set("authors", refsInput["authors"] as RelationRef[]);
    map.set("hero", [refsInput["hero"] as RelationRef]);
    return map;
  }

  function splitPrev(input: Record<string, unknown>) {
    return splitRecordInput(articleType(), input);
  }

  it("marks every provided field as changed for a new record", () => {
    const change = computeChangeSet(type, input, null, new Map());
    expect(change.changedFields.sort()).toEqual(
      ["authors", "body", "hero", "published_at", "slug", "tags", "title"].sort(),
    );
    expect(change.dataChanged).toBe(true);
    expect(change.data["authors"]).toBeUndefined();
    expect(change.relationWrites).toEqual([
      { fieldKey: "authors", refs: input["authors"] },
      { fieldKey: "hero", refs: [input["hero"]] },
    ]);
  });

  it("detects a single scalar change", () => {
    const { data: prevData } = splitPrev(input);
    const next = { ...input, title: "改題" };
    const change = computeChangeSet(type, next, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual(["title"]);
  });

  it("detects relation reorder as a change to that field only", () => {
    const { data: prevData } = splitPrev(input);
    const authors = input["authors"] as RelationRef[];
    const reversed = [...authors].reverse();
    const change = computeChangeSet(
      type,
      { ...input, authors: reversed },
      prevData,
      prevRelationsOf(input),
    );
    expect(change.changedFields).toEqual(["authors"]);
  });

  it("treats an omitted optional relation as cleared", () => {
    const { data: prevData } = splitPrev(input);
    const { hero: _hero, ...withoutHero } = input;
    const change = computeChangeSet(type, withoutHero, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual(["hero"]);
    expect(change.relationWrites.find((w) => w.fieldKey === "hero")?.refs).toEqual([]);
  });

  it("reports unknown-key-only edits via dataChanged with empty changedFields", () => {
    const { data: prevData } = splitPrev(input);
    const change = computeChangeSet(
      type,
      { ...input, legacy_field: "new value" },
      prevData,
      prevRelationsOf(input),
    );
    expect(change.changedFields).toEqual([]);
    expect(change.dataChanged).toBe(true);
  });

  it("returns a no-op change set for identical input", () => {
    const { data: prevData } = splitPrev(input);
    const change = computeChangeSet(type, { ...input }, prevData, prevRelationsOf(input));
    expect(change.changedFields).toEqual([]);
    expect(change.dataChanged).toBe(false);
  });
});
