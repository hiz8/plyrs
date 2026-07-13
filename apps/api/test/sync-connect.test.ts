import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { SYNC_SUBPROTOCOL } from "@plyrs/sync-protocol";
import { app } from "../src/index";
import { signTenantToken } from "../src/auth/jwt";
import { blockUser } from "../src/auth/blocklist";
import { openSyncSocket } from "./ws-helpers";

const TENANT = "018f2b6a-7a0a-7000-8000-0000000000a1";
const OTHER_TENANT = "018f2b6a-7a0a-7000-8000-0000000000a2";

async function tokenFor(userId: string, tenantId = TENANT, role = "editor" as const) {
  return signTenantToken(env.JWT_SECRET, { userId, tenantId, role });
}

function stub(tenantId: string) {
  return env.TENANT_DO.get(env.TENANT_DO.idFromName(tenantId));
}

describe("sync WebSocket upgrade", () => {
  it("accepts an authenticated upgrade and echoes the subprotocol", async () => {
    const token = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b1");
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}`,
        },
      },
      env,
    );
    expect(res.status).toBe(101);
    expect(res.headers.get("sec-websocket-protocol")).toBe(SYNC_SUBPROTOCOL);
    expect(res.webSocket).not.toBeNull();
    res.webSocket?.accept();
    res.webSocket?.close(1000, "done");
  });

  it("rejects a non-upgrade request to the sync path", async () => {
    const token = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b2");
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      { headers: { "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}` } },
      env,
    );
    expect(res.status).toBe(426);
  });

  it("rejects an upgrade with no token, a bogus token, or a wrong-tenant token", async () => {
    const noToken = await app.request(
      `/v1/t/${TENANT}/sync`,
      { headers: { upgrade: "websocket", "sec-websocket-protocol": SYNC_SUBPROTOCOL } },
      env,
    );
    expect(noToken.status).toBe(401);

    const bogus = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.not-a-jwt`,
        },
      },
      env,
    );
    expect(bogus.status).toBe(401);

    const otherTenant = await tokenFor("018f2b6a-7a0a-7000-8000-0000000000b3", OTHER_TENANT);
    const wrongTenant = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${otherTenant}`,
        },
      },
      env,
    );
    expect(wrongTenant.status).toBe(403);
  });

  it("rejects an upgrade from a blocked user", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000b4";
    await blockUser(env.BLOCKLIST, userId);
    const token = await tokenFor(userId);
    const res = await app.request(
      `/v1/t/${TENANT}/sync`,
      {
        headers: {
          upgrade: "websocket",
          "sec-websocket-protocol": `${SYNC_SUBPROTOCOL}, token.${token}`,
        },
      },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a direct DO upgrade with no verified auth header (worker is the trust boundary)", async () => {
    const res = await stub(TENANT).fetch("https://do/sync", {
      headers: { upgrade: "websocket" },
    });
    expect(res.status).toBe(401);
  });

  it("tags the socket by user so it can be addressed later", async () => {
    const userId = "018f2b6a-7a0a-7000-8000-0000000000b5";
    const target = stub(`${TENANT}-tagged`);
    const { socket } = await openSyncSocket(target, {
      userId,
      role: "editor",
      tenantId: TENANT,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    expect(await target.countSockets(`user:${userId}`)).toBe(1);
    socket.close(1000, "done");
  });
});
