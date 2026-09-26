import Link from "next/link";
import type { Metadata } from "next";
import { PublicIntakeQueue } from "@/components/jeeves/public-intake-queue";

// The operator's page: real requests sent through "Send a real request".
//
// Outside both route groups on purpose. It is not part of the playground
// console — the persona picker there means nothing here, since this page is
// opened by the site's OPERATOR_TOKEN, not by any persona — and it is not
// marketing content. Unlinked from navigation and kept out of search.
export const metadata: Metadata = {
  title: "Real requests",
  description: "Operator view of requests sent through the public intake form.",
  robots: { index: false, follow: false },
};

export default function OperatorPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-1.5">
        <span className="kicker">Operator</span>
        <h1 className="text-2xl font-semibold tracking-tight">Real requests</h1>
        <p className="text-sm text-muted-foreground">
          Requests people sent through &ldquo;Send a real request&rdquo;, with the
          address each one asked you to reply to. Nothing from the demo
          playground appears here.
        </p>
      </div>
      <PublicIntakeQueue />
      <p className="text-xs text-muted-foreground">
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to the site
        </Link>
      </p>
    </main>
  );
}
