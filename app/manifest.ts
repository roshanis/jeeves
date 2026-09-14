import type { MetadataRoute } from "next";

// Web app manifest — completes the icon set (Android/Chrome installability
// and the address-bar theme colour) alongside app/icon.svg, app/apple-icon
// .tsx and app/favicon.ico.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Jeeves — AI Governance Gateway",
    short_name: "Jeeves",
    description:
      "Intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives. Fictional demo with synthetic data.",
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
