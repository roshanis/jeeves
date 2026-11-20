import { LandingPage } from "@/components/jeeves/landing-page";
import { CONSOLE_HOME, demoPageMetadata, guardDemoPage } from "@/lib/config/demo-pages";


// Production has no storefront: "/" sends the visitor to the console (which
// sends them on to sign-in), from the page AND from its metadata.
export const generateMetadata = demoPageMetadata(
  {
    // Absolute: this is the brand page, so it keeps the site title
    // rather than being prefixed by the template.
    title: {
      absolute: "Jeeves — AI Governance Gateway for health plans",
    },
    description:
      "An AI governance gateway: intake, risk tiering, domain review, approval and continuous monitoring — shown end to end on a fictional healthcare payer with synthetic data.",
  },
  { redirectTo: CONSOLE_HOME },
);

// Static, read-only public landing page. The operations Inbox (the former
// contents of this file) now lives at /inbox — see
// app/(console)/inbox/page.tsx and app/(console)/layout.tsx for the console
// chrome that wraps it.
export default function HomePage() {
  guardDemoPage({ redirectTo: CONSOLE_HOME });
  return <LandingPage />;
}
