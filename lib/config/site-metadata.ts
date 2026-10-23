// Everything a crawler, a link preview or a browser tab reads, per deployment
// mode. Pure functions of the environment, so each can be tested without a
// server and the app files (layout, robots, manifest, opengraph-image) stay
// thin.
//
// DEMO is the public site: indexable, "Meridian Health demo" in the title, the
// fictional-payer disclaimer in every description, origin from the build-time
// NEXT_PUBLIC_SITE_URL. Its output here is byte-for-byte what app/layout.tsx
// exported before the mode existed.
//
// PRODUCTION is one customer's installation behind their own sign-in: no demo
// wording, not indexable, and an origin taken from the RUNTIME APP_BASE_URL.
// NEXT_PUBLIC_* values are inlined at build, so reading SITE_URL here would
// bake one origin into every customer's image.
import type { Metadata } from "next";
import { SITE_URL } from "../marketing/site-config";
import { deploymentMode, type DeploymentMode } from "./deployment-mode";

type Env = Record<string, string | undefined>;

/**
 * This installation's own origin from APP_BASE_URL, or null when it is unset
 * or not a plain https URL. Production boot refuses to start without a valid
 * one (assertProductionConfig); null here only means "omit the base" for a
 * caller that runs before or without that check, instead of inventing one.
 */
export function installBaseUrl(env: Env = process.env): URL | null {
  const raw = env.APP_BASE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname !== "" && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

export function rootMetadata(env: Env = process.env): Metadata {
  return deploymentMode(env) === "demo" ? demoMetadata() : productionMetadata(env);
}

function demoMetadata(): Metadata {
  return {
    // metadataBase makes every relative OG/twitter image URL below resolve to
    // an absolute one. Without it Next warns at build time and social
    // crawlers, which do not resolve relative paths, silently show no image.
    metadataBase: new URL(SITE_URL),
    title: {
      // Per-page `title` strings are slotted into this template, so a tab
      // reads "Portfolio · Jeeves" rather than the same site-wide string on
      // all 18 pages. A page that owns its own branding (the landing page)
      // opts out with `title: { absolute }`.
      template: "%s · Jeeves",
      default: "Jeeves — AI Governance Gateway (Meridian Health demo)",
    },
    description:
      "Fictional demo — synthetic data. AI governance workflow demo for a fictional healthcare payer.",
    applicationName: "Jeeves",
    openGraph: {
      type: "website",
      siteName: "Jeeves",
      title: "Jeeves — AI Governance Gateway",
      description:
        "Intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives — demonstrated end to end on a fictional healthcare payer.",
      url: SITE_URL,
    },
    twitter: {
      card: "summary_large_image",
      title: "Jeeves — AI Governance Gateway",
      description:
        "Intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives — demonstrated on a fictional healthcare payer.",
    },
  };
}

function productionMetadata(env: Env): Metadata {
  const base = installBaseUrl(env);
  const description =
    "AI governance workflow: intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives.";
  return {
    ...(base ? { metadataBase: base } : {}),
    title: { template: "%s · Jeeves", default: "Jeeves — AI Governance Gateway" },
    description,
    applicationName: "Jeeves",
    // An installation lives in the customer's own account behind their
    // sign-in; nothing on it is for a search index.
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      siteName: "Jeeves",
      title: "Jeeves — AI Governance Gateway",
      description,
      ...(base ? { url: base.href } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: "Jeeves — AI Governance Gateway",
      description,
    },
  };
}

/** Link-preview card (app/opengraph-image.tsx): its alt text and footer line. */
export function ogCopy(mode: DeploymentMode): { alt: string; footer: string } {
  return mode === "demo"
    ? {
        alt: "Jeeves — AI Governance Gateway. Intake, risk tiering, domain review, approval and monitoring for AI initiatives. Fictional demo with synthetic data.",
        footer: "Fictional demo · synthetic data · no real patient information",
      }
    : {
        alt: "Jeeves — AI Governance Gateway. Intake, risk tiering, domain review, approval and monitoring for AI initiatives.",
        footer: "",
      };
}

/** Web app manifest description (app/manifest.ts). */
export function manifestDescription(mode: DeploymentMode): string {
  return mode === "demo"
    ? "Intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives. Fictional demo with synthetic data."
    : "Intake, risk tiering, domain review, approval and continuous monitoring for AI initiatives.";
}
