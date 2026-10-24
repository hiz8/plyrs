import { createFileRoute } from "@tanstack/react-router";

// 描画は親の media/route.tsx(F5)。assetId は親が useParams({ strict: false }) で読む
export const Route = createFileRoute("/t/$tenantSlug/media/$assetId")({});
