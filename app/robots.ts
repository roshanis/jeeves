import type { MetadataRoute } from "next";
import { isProductionMode } from "@/lib/config/deployment-mode";
import { SITE_URL } from "@/lib/marketing/site-config";

// Read per request: the mode is a runtime setting, and a statically generated
// robots.txt would freeze whichever mode the build ran in.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  // A production installation is one customer's, behind their own sign-in:
  // nothing on it is for a search index, and there is no public sitemap.
  if (isProductionMode()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
