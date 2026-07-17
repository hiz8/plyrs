import { describe, expect, it } from "vitest";
import { sniffImageSize } from "./image-size";

// フィクスチャは実画像ではなく、各形式の寸法ヘッダ部分だけを手組みする(スニファは
// 先頭バイトしか読まないため十分)。
function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part instanceof Uint8Array ? part : Uint8Array.from(part), offset);
    offset += part.length;
  }
  return out;
}

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

describe("sniffImageSize", () => {
  it("reads PNG IHDR dimensions (big endian)", () => {
    const png = bytes(
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // signature
      [0x00, 0x00, 0x00, 0x0d], // IHDR length
      ascii("IHDR"),
      [0x00, 0x00, 0x03, 0x20], // width 800
      [0x00, 0x00, 0x02, 0x58], // height 600
      [0x08, 0x06, 0x00, 0x00, 0x00], // bit depth ほか(読まない)
    );
    expect(sniffImageSize(png)).toEqual({ width: 800, height: 600 });
  });

  it("reads JPEG SOF0 dimensions, skipping APP segments", () => {
    const jpeg = bytes(
      [0xff, 0xd8], // SOI
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // APP0(length 4 = 中身 2 バイト)
      [0xff, 0xc0, 0x00, 0x0b], // SOF0, length 11
      [0x08], // precision
      [0x02, 0x58], // height 600
      [0x03, 0x20], // width 800
      [0x03, 0x01, 0x22, 0x00], // components(読まない)
    );
    expect(sniffImageSize(jpeg)).toEqual({ width: 800, height: 600 });
  });

  it("does not mistake DHT (0xC4) for a SOF marker", () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00], // DHT(スキップされるべき)
      [0xff, 0xc2, 0x00, 0x0b, 0x08], // SOF2(progressive)
      [0x00, 0x64], // height 100
      [0x00, 0xc8], // width 200
      [0x03, 0x01, 0x22, 0x00],
    );
    expect(sniffImageSize(jpeg)).toEqual({ width: 200, height: 100 });
  });

  it("reads GIF logical screen dimensions (little endian)", () => {
    const gif = bytes(ascii("GIF89a"), [0x20, 0x03], [0x58, 0x02], [0x00, 0x00, 0x00]);
    expect(sniffImageSize(gif)).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP VP8X canvas dimensions", () => {
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8X"),
      [0x0a, 0x00, 0x00, 0x00], // chunk size 10
      [0x00, 0x00, 0x00, 0x00], // flags + reserved
      [0x1f, 0x03, 0x00], // width-1 = 799
      [0x57, 0x02, 0x00], // height-1 = 599
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("reads WebP lossy (VP8) frame dimensions", () => {
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8 "),
      [0x10, 0x00, 0x00, 0x00], // chunk size
      [0x00, 0x00, 0x00], // frame tag(読まない)
      [0x9d, 0x01, 0x2a], // start code
      [0x20, 0x03], // width 800 (14bit LE)
      [0x58, 0x02], // height 600
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("returns null for truncated WebP VP8 after start code", () => {
    const webp = bytes(
      ascii("RIFF"),
      [0x12, 0x00, 0x00, 0x00], // size = 18 (file size - 8)
      ascii("WEBP"),
      ascii("VP8 "),
      [0x0a, 0x00, 0x00, 0x00], // chunk size = 10
      [0x00, 0x00, 0x00], // frame tag
      [0x9d, 0x01, 0x2a], // start code
      // truncated here, no dimension bytes
    );
    expect(sniffImageSize(webp)).toBeNull();
  });

  it("reads WebP lossless (VP8L) dimensions", () => {
    // width-1=799 (14bit), height-1=599 (14bit) を LSB からパックした 32bit 値:
    // v = 799 | (599 << 14) = 0x0095c31f → bytes LE: 1f c3 95 00
    const webp = bytes(
      ascii("RIFF"),
      [0x20, 0x00, 0x00, 0x00],
      ascii("WEBP"),
      ascii("VP8L"),
      [0x10, 0x00, 0x00, 0x00],
      [0x2f], // signature
      [0x1f, 0xc3, 0x95, 0x00],
    );
    expect(sniffImageSize(webp)).toEqual({ width: 800, height: 600 });
  });

  it("returns null for unknown or truncated input", () => {
    expect(sniffImageSize(Uint8Array.from(ascii("plain text")))).toBeNull();
    expect(sniffImageSize(new Uint8Array(0))).toBeNull();
    expect(sniffImageSize(Uint8Array.from([0x89, 0x50]))).toBeNull(); // PNG 先頭だけ
    expect(sniffImageSize(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull(); // JPEG 断片
  });
});
