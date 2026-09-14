import { LandingPage } from "@/components/jeeves/landing-page";
import type { Metadata } from "next";


export const metadata: Metadata = {
  // Absolute: this is the brand page, so it keeps the site title
  // rather than being prefixed by the template.
  title: {
    absolute: "Jeeves — AI Governance Gateway for health plans",
  },
  description:
    "An AI governance gateway: intake, risk tiering, domain review, approval and continuous monitoring — shown end to end on a fictional healthcare payer with synthetic data.",
};

// Static, read-only public landing page. The operations Inbox (the former
// contents of this file) now lives at /inbox — see
// app/(console)/inbox/page.tsx and app/(console)/layout.tsx for the console
// chrome that wraps it.
export default function HomePage() {
  return <LandingPage />;
}
