import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/marketing/site-config";

type Change = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

// Public marketing routes only — the operations console (/inbox, /portfolio,
// etc.) is a read-only demo surface, not content meant for search indexing.
export default function sitemap(): MetadataRoute.Sitemap {
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

  const lastModified = new Date();

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
