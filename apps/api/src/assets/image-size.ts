// アップロード時に画像の寸法をサーバー側で導出する(クライアント申告値は信用しない —
// width/height は asset のシステム管理フィールド)。マジックバイト判定なので Content-Type
// ヘッダにも依存しない。対応: PNG / JPEG / GIF / WebP。非対応・壊れた入力は null
// (寸法なしの asset として保存される — 画像以外のファイルの正常系)。
export interface ImageSize {
  width: number;
  height: number;
}

function u16be(bytes: Uint8Array, offset: number): number {
  // 呼び出し元が境界チェック済み。noUncheckedIndexedAccess のため ?? 0 で畳む
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function u24le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function matches(bytes: Uint8Array, offset: number, expected: string): boolean {
  if (bytes.length < offset + expected.length) {
    return false;
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (bytes[offset + i] !== expected.charCodeAt(i)) {
      return false;
    }
  }
  return true;
}

function sniffPng(bytes: Uint8Array): ImageSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, i) => bytes[i] !== byte)) {
    return null;
  }
  if (!matches(bytes, 12, "IHDR")) {
    return null;
  }
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function sniffJpeg(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null; // マーカー境界が壊れている
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1; // パディング
      continue;
    }
    // SOF0-15(C0-CF)のうち DHT(C4)/JPG(C8)/DAC(CC) はフレームヘッダではない
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) };
    }
    if (marker === 0xda || marker === 0xd9) {
      return null; // SOS/EOI まで来たら SOF は現れない
    }
    offset += 2 + u16be(bytes, offset + 2);
  }
  return null;
}

function sniffGif(bytes: Uint8Array): ImageSize | null {
  if (!(matches(bytes, 0, "GIF87a") || matches(bytes, 0, "GIF89a")) || bytes.length < 10) {
    return null;
  }
  return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function sniffWebp(bytes: Uint8Array): ImageSize | null {
  // 長さの下限は形式ごとに異なるため、読み出しは ?? 0 畳み(u16le/u24le)と matches の
  // 境界チェックに任せ、ここではコンテナ判定のみ行う。
  if (!matches(bytes, 0, "RIFF") || !matches(bytes, 8, "WEBP")) {
    return null;
  }
  // 最初のチャンク(offset 12)だけを見る。VP8X が無い単純形式は VP8 / VP8L が先頭に来る。
  const data = 20; // チャンク FourCC(12..16) + サイズ(16..20) の直後
  if (matches(bytes, 12, "VP8X")) {
    if (bytes.length < data + 10) {
      return null;
    }
    return {
      width: u24le(bytes, data + 4) + 1,
      height: u24le(bytes, data + 7) + 1,
    };
  }
  if (matches(bytes, 12, "VP8 ")) {
    // 3 バイトのフレームタグの後に start code 9D 01 2A、続いて 14bit LE の寸法
    if (bytes.length < data + 10) {
      return null;
    }
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
      return null;
    }
    return {
      width: u16le(bytes, data + 6) & 0x3fff,
      height: u16le(bytes, data + 8) & 0x3fff,
    };
  }
  if (matches(bytes, 12, "VP8L")) {
    if (bytes[data] !== 0x2f || bytes.length < data + 5) {
      return null;
    }
    // 寸法は signature 直後の 32bit LE 値に LSB からパックされている
    const packed =
      (bytes[data + 1] ?? 0) |
      ((bytes[data + 2] ?? 0) << 8) |
      ((bytes[data + 3] ?? 0) << 16) |
      ((bytes[data + 4] ?? 0) << 24);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }
  return null;
}

export function sniffImageSize(bytes: Uint8Array): ImageSize | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes);
}
