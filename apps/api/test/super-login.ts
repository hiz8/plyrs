import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { superAdmins, superSessions } from "@plyrs/db/control-plane";
import { generateTotpCode } from "../src/auth/totp";
import { app } from "../src/index";

export function fakeLimiter(succeeds: boolean): RateLimit {
  return { limit: async () => ({ success: succeeds }) } as RateLimit;
}
export const superEnv = (): Env => ({ ...env, AUTH_LIMITER: fakeLimiter(true) }) as Env;

// bootstrap → login して super cookie を返す。呼び出し側は afterEach で resetSuperAdmins() を呼ぶこと
// (共有 D1 のリーク対策 — tenant_modules と同じ規律)。
export async function superLogin(): Promise<{ cookie: string; adminId: string }> {
  const e = superEnv();
  const creds = { email: `root+${crypto.randomUUID()}@x.com`, password: "super-password-123" };
  const boot = await app.request(
    new Request("https://api.test/super-auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(creds),
    }),
    undefined,
    e,
  );
  if (boot.status !== 201) throw new Error(`bootstrap failed: ${boot.status}`);
  const { adminId, totpSecret } = (await boot.json()) as { adminId: string; totpSecret: string };
  const login = await app.request(
    new Request("https://api.test/super-auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...creds, totpCode: await generateTotpCode(totpSecret, Date.now()) }),
    }),
    undefined,
    e,
  );
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { cookie, adminId };
}

export async function resetSuperAdmins(): Promise<void> {
  const db = drizzle(env.DB);
  await db.delete(superSessions);
  await db.delete(superAdmins);
}
