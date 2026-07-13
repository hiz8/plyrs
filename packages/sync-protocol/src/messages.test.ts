import { describe, expect, it } from "vitest";
import { CLOSE_CODES, parseClientMessage, SYNC_SUBPROTOCOL } from "./messages";

const UUID = "018f2b6a-7a0a-7000-8000-000000000001";

describe("wire constants", () => {
  it("pins the subprotocol and close codes", () => {
    expect(SYNC_SUBPROTOCOL).toBe("plyrs-sync");
    expect(CLOSE_CODES).toEqual({ tokenExpired: 4001, protocolError: 4002, blocked: 4003 });
  });
});

describe("parseClientMessage", () => {
  it("parses a hello message", () => {
    expect(parseClientMessage(JSON.stringify({ type: "hello", checkpoint: 42 }))).toEqual({
      type: "hello",
      checkpoint: 42,
    });
  });

  it("parses a push message with an upsert change", () => {
    const change = {
      changeId: UUID,
      recordId: UUID,
      typeKey: "article",
      op: "upsert",
      input: { title: "hi" },
      changedFields: ["title"],
      baseFieldVersions: { title: 1 },
      status: "draft",
    };
    const parsed = parseClientMessage(JSON.stringify({ type: "push", changes: [change] }));
    expect(parsed).toEqual({ type: "push", changes: [change] });
  });

  it("parses a delete change without input fields", () => {
    const parsed = parseClientMessage(
      JSON.stringify({
        type: "push",
        changes: [
          {
            changeId: UUID,
            recordId: UUID,
            typeKey: "article",
            op: "delete",
            input: {},
            changedFields: [],
            baseFieldVersions: {},
          },
        ],
      }),
    );
    expect(parsed?.type).toBe("push");
  });

  it("returns null (never throws) for malformed input", () => {
    expect(parseClientMessage("{not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "hello", checkpoint: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "hello" }))).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "push",
          changes: [
            {
              changeId: "not-a-uuid",
              recordId: UUID,
              typeKey: "a",
              op: "upsert",
              input: {},
              changedFields: [],
              baseFieldVersions: {},
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "push",
          changes: [
            {
              changeId: UUID,
              recordId: UUID,
              typeKey: "a",
              op: "purge",
              input: {},
              changedFields: [],
              baseFieldVersions: {},
            },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects a push with an oversized change batch", () => {
    const change = {
      changeId: UUID,
      recordId: UUID,
      typeKey: "article",
      op: "upsert" as const,
      input: {},
      changedFields: [],
      baseFieldVersions: {},
    };
    const changes = Array.from({ length: 101 }, () => change);
    expect(parseClientMessage(JSON.stringify({ type: "push", changes }))).toBeNull();
  });
});
