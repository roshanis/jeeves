import type { MetadataRoute } from "next";
import { deploymentMode } from "@/lib/config/deployment-mode";
import { manifestDescription } from "@/lib/config/site-metadata";

// Read per request: the description is mode-aware and a statically generated
// manifest would freeze whichever mode the build ran in.
export const dynamic = "force-dynamic";

// Web app manifest — completes the icon set (Android/Chrome installability
// and the address-bar theme colour) alongside app/icon.svg, app/apple-icon
// .tsx and app/favicon.ico.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jeeves — AI Governance Gateway",
    short_name: "Jeeves",
    description: manifestDescription(deploymentMode()),
    start_url: "/",
    display: "standalone",
    background_color: "#0d2b33",
    theme_color: "#0d2b33",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
