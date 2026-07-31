import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketing/site-config";

// Public marketing routes only — the operations console (/inbox, /portfolio,
// etc.) is a read-only demo surface, not content meant for search indexing.
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = [
    "/",
    "/frameworks",
    "/frameworks/nist-ai-rmf",
    "/frameworks/eu-ai-act",
    "/pilot",
  ];

  return routes.map((route) => ({
    url: `${SITE_URL}${route}`,
  }));
}
