import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CONTACT_URL } from "@/lib/marketing/site-config";
import { cn } from "@/lib/utils";

// Where a public submission lands.
//
// Before this page, submitting pushed straight to the console case file for
// the new initiative — right for a demo persona walking the governance flow,
// wrong for a member of the public, who gets dropped into an operations
// console full of internal state with no idea whether their request went
// anywhere.
//
// The job here is to answer three questions honestly: did it arrive, what
// happens next, and when will someone look. The third is the one most
// confirmation pages fudge; this one says plainly that a human has to pick
// it up and that no timeline is promised, which is true of a demo.
export const metadata: Metadata = {
  title: "Request received",
  description:
    "Your AI governance request has been received and is queued for the Program Office to check.",
  // A confirmation page has no value in search results and can only be
  // reached by submitting, so keep it out of the index.
  robots: { index: false, follow: true },
};

const STEPS = [
  {
    title: "Quality check",
    detail:
      "The Program Office reads your intake for completeness before anyone else is asked to spend time on it. If something is missing they send it back with a reason rather than guessing.",
  },
  {
    title: "Risk tiering and routing",
    detail:
      "Once it passes, deterministic rules set a risk tier and decide which governance domains have to review it — legal, privacy, clinical safety, security and the rest.",
  },
  {
    title: "Review and decision",
    detail:
      "Each required domain reviews it and a named accountable approver records the decision. AI agents draft and recommend throughout; they never approve.",
  },
];

export default function ThankYouPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-16">
      <div className="flex flex-col gap-3">
        <span
          className="grid size-11 place-items-center rounded-full bg-status-ok-bg text-status-ok-fg"
          aria-hidden
        >
          <CheckCircle2 className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your request has been received
        </h1>
        <p className="text-sm text-muted-foreground">
          It is queued for the Program Office. Nothing is routed, reviewed or
          approved automatically — a person checks it first.
        </p>
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <span className="kicker">What happens next</span>
        </div>
        <ol className="divide-y">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3 px-4 py-3.5">
              <span className="label-mono mt-0.5 shrink-0 text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">This is a demonstration system.</span>{" "}
          &ldquo;Meridian Health&rdquo; is a fictional payer and every record here is
          synthetic. No timeline is promised, and nothing you submit reaches a
          real health plan.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className={cn(buttonVariants({ size: "sm" }))}>
          Back to home
        </Link>
        <Link
          href="/portfolio"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          See how requests are governed
        </Link>
        <a
          href={CONTACT_URL}
          className={cn(buttonVariants({ size: "sm", variant: "ghost" }))}
        >
          Contact us
        </a>
      </div>
    </main>
  );
}
