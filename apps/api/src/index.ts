export { TenantDO } from "./tenant-do";

export default {
  async fetch(): Promise<Response> {
    return new Response("plyrs api: not yet implemented", { status: 501 });
  },
} satisfies ExportedHandler<Env>;
