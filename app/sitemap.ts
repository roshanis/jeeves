import type { MetadataRoute } from "next";
import { isProductionMode } from "@/lib/config/deployment-mode";
import { LEGAL_LAST_UPDATED, MARKETING_LAST_MODIFIED, SITE_URL } from "@/lib/marketing/site-config";

type Change = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

// Read per request: the mode is a runtime setting, and a statically generated
// sitemap would freeze whichever mode the build ran in.
export const dynamic = "force-dynamic";

// Public marketing routes only — the operations console (/inbox, /portfolio,
// etc.) is a read-only demo surface, not content meant for search indexing.
export default function sitemap(): MetadataRoute.Sitemap {
  // Production has no marketing site (those pages answer 404 there), so there
  // is nothing to list.
  if (isProductionMode()) return [];

  // /thank-you is deliberately absent: it is a confirmation page, reachable
  // only by submitting, and its own metadata marks it noindex.
  const routes: { path: string; priority: number; changeFrequency: Change }[] = [
    { path: "/", priority: 1, changeFrequency: "monthly" },
    { path: "/frameworks", priority: 0.8, changeFrequency: "monthly" },
    { path: "/frameworks/nist-ai-rmf", priority: 0.6, changeFrequency: "yearly" },
    { path: "/frameworks/eu-ai-act", priority: 0.6, changeFrequency: "yearly" },
    { path: "/pilot", priority: 0.8, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "yearly" },
    { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
  ];

  // Fixed dates, not the request time: a lastmod that always says "now" teaches
  // crawlers to ignore it.
  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(
      path === "/privacy" || path === "/terms" ? LEGAL_LAST_UPDATED : MARKETING_LAST_MODIFIED,
    ),
    changeFrequency,
    priority,
  }));
}
