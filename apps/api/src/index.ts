import { Hono } from "hono";
import { authRoutes } from "./routes/auth";
import { tenantRoutes } from "./routes/tenant";
import { tenantAdminRoutes } from "./routes/tenants";

export { TenantDO } from "./tenant-do";

const app = new Hono<{ Bindings: Env }>();
app.route("/auth", authRoutes);
app.route("/v1/tenants", tenantAdminRoutes);
app.route("/v1/t", tenantRoutes);
app.notFound((c) => c.json({ error: "not_found" }, 404));

export default app satisfies ExportedHandler<Env>;
