import { describe, expect, it } from "vitest";
import type { MemberSummary } from "./admin-api";
import { MEMBER_LABELS } from "./labels";
import { demoteBody, isDowngrade, lastOwnerId, memberRows, otherOwnerEmails } from "./members";

function member(userId: string, role: string, createdAt = "2026-07-16T00:00:00Z"): MemberSummary {
  return { userId, email: `${userId}@example.com`, role, createdAt };
}

describe("members", () => {
  it("isDowngrade は rank が下がるときだけ true", () => {
    expect(isDowngrade("owner", "editor")).toBe(true);
    expect(isDowngrade("owner", "viewer")).toBe(true);
    expect(isDowngrade("editor", "owner")).toBe(false);
    expect(isDowngrade("editor", "editor")).toBe(false);
    expect(isDowngrade("x", "viewer")).toBe(false);
    expect(isDowngrade("owner", "x")).toBe(false);
  });

  it("lastOwnerId は owner が 1 人のときだけその userId", () => {
    expect(lastOwnerId([member("a", "owner"), member("b", "editor")])).toBe("a");
    expect(lastOwnerId([member("a", "owner"), member("b", "owner")])).toBeNull();
    expect(lastOwnerId([member("b", "editor")])).toBeNull();
  });

  it("otherOwnerEmails は自分以外の owner を参加日順に返す", () => {
    const members = [
      member("a", "owner", "2026-07-01T00:00:00Z"),
      member("b", "editor", "2026-07-02T00:00:00Z"),
      member("c", "owner", "2026-07-03T00:00:00Z"),
      member("d", "owner", "2026-07-04T00:00:00Z"),
    ];
    expect(otherOwnerEmails(members, "a")).toEqual(["c@example.com", "d@example.com"]);
    expect(otherOwnerEmails(members, undefined)).toEqual([
      "a@example.com",
      "c@example.com",
      "d@example.com",
    ]);
  });

  it("memberRows は自分と最後の管理者の印を付ける", () => {
    const members = [member("a", "owner"), member("b", "editor")];
    const rows = memberRows(members, "b");
    expect(rows.map((r) => [r.member.userId, r.isSelf, r.isLastOwner])).toEqual([
      ["a", false, true],
      ["b", true, false],
    ]);
    expect(memberRows(members, undefined).every((r) => !r.isSelf)).toBe(true);
  });

  it("demoteBody はロールごとの説明を返す", () => {
    expect(demoteBody("viewer")).toBe(MEMBER_LABELS.demote.toViewer);
    expect(demoteBody("editor")).toBe(MEMBER_LABELS.demote.toEditor);
    expect(demoteBody("owner")).toBe("");
  });
});
