import { LandingPage } from "@/components/jeeves/landing-page";

// Static, read-only public landing page. The operations Inbox (the former
// contents of this file) now lives at /inbox — see
// app/(console)/inbox/page.tsx and app/(console)/layout.tsx for the console
// chrome that wraps it.
export default function HomePage() {
  return <LandingPage />;
}
