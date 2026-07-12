import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role } from "./permissions";

// design-spec §11.2/§11.4: 短命 JWT（15分）は「粗い身分証」。載せるのは
// sub（userId）/ tid（tenantId）/ role のみ。型×操作の展開はサーバー側（DO）で行う。
const TOKEN_TTL_SECONDS = 15 * 60;

export const TOKEN_TTL = TOKEN_TTL_SECONDS;

export interface TenantClaims {
  userId: string;
  tenantId: string;
  role: Role;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signTenantToken(secret: string, claims: TenantClaims): Promise<string> {
  return new SignJWT({ tid: claims.tenantId, role: claims.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifyTenantToken(
  secret: string,
  token: string,
): Promise<TenantClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), { clockTolerance: 5 });
    const sub = payload.sub;
    const tid = payload["tid"];
    const role = payload["role"];
    if (typeof sub !== "string" || typeof tid !== "string" || !isRole(role)) {
      return null;
    }
    return { userId: sub, tenantId: tid, role };
  } catch {
    return null;
  }
}
