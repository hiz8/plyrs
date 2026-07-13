import { describe, expect, it } from "vitest";
import { socketCloseCode, socketMessageData } from "./transport";

describe("socketMessageData", () => {
  it("returns the string payload of a message event", () => {
    expect(socketMessageData({ data: '{"t":"ack"}' })).toBe('{"t":"ack"}');
  });

  it("returns null for a non-string payload", () => {
    expect(socketMessageData({ data: new ArrayBuffer(4) })).toBeNull();
  });

  it("returns null when the event carries no data", () => {
    expect(socketMessageData({})).toBeNull();
    expect(socketMessageData(null)).toBeNull();
  });
});

describe("socketCloseCode", () => {
  it("returns the numeric close code", () => {
    expect(socketCloseCode({ code: 1000 })).toBe(1000);
  });

  it("falls back to 1006 when the code is missing", () => {
    expect(socketCloseCode({})).toBe(1006);
    expect(socketCloseCode(null)).toBe(1006);
  });

  it("honours an explicit fallback", () => {
    expect(socketCloseCode({ code: "nope" }, 4000)).toBe(4000);
  });
});
