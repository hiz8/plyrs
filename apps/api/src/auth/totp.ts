// RFC 6238 TOTP(SHA-1 / 6 桁 / 30 秒 step)。WebCrypto のみで実装し依存を増やさない。
// SHA-1 は HMAC 用途では現行 authenticator アプリの互換既定(RFC 4226 準拠)。
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(encoded: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of encoded.toUpperCase().replace(/=+$/, "")) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      return null;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    "raw",
    secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

export async function generateTotpCode(secretBase32: string, nowMs: number): Promise<string> {
  const secret = base32Decode(secretBase32);
  if (secret === null) {
    throw new Error("invalid base32 secret");
  }
  return hotp(secret, Math.floor(nowMs / 1000 / STEP_SECONDS));
}

// 一致した counter を返す(呼び出し側が totp_last_counter との単調性でリプレイを拒否する)。
export async function verifyTotpCode(
  secretBase32: string,
  code: string,
  nowMs: number,
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) {
    return null;
  }
  const secret = base32Decode(secretBase32);
  if (secret === null) {
    return null;
  }
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const candidate = counter + drift;
    if (candidate >= 0 && (await hotp(secret, candidate)) === code) {
      return candidate;
    }
  }
  return null;
}

export function otpauthUri(email: string, secretBase32: string): string {
  return `otpauth://totp/plyrs:${encodeURIComponent(email)}?secret=${secretBase32}&issuer=plyrs&algorithm=SHA1&digits=6&period=30`;
}
