import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Where a real request lands after "Send a real request".
//
// The job is to answer three questions honestly: did it arrive, who reads
// it, and what happens next. An earlier version promised a Program Office
// quality check followed by triage and domain review. None of that happens
// to a real request — in the passwordless playground anyone can play the
// Program Office, so real requests go to the people running the site
// instead (the OPERATOR_TOKEN queue) and are answered by email. This page
// says that, and nothing it cannot keep.
export const metadata: Metadata = {
  title: "Request sent",
  description:
    "Your request has been sent to the team running this site, who will reply by email.",
  // Reachable only by submitting, and of no value in search results.
  robots: { index: false, follow: true },
};

const STEPS = [
  {
    title: "A person reads it",
    detail:
      "Every real request is read by the team running this site. Nothing about it is routed, scored or decided automatically, and no AI model has processed it.",
  },
  {
    title: "They reply by email",
    detail:
      "The reply goes to the email address you gave in the form. If that address was mistyped there is no other way to reach you, so it may be worth sending a note from the right one.",
  },
];

export default function ThankYouPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-16">
      <div className="flex flex-col gap-3">
        <span
          className="grid size-11 place-items-center rounded-full bg-status-good-bg text-status-good-fg"
          aria-hidden
        >
          <CheckCircle2 className="size-6" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your request has been sent
        </h1>
        <p className="text-sm text-muted-foreground">
          It went to the team running this site — not into the demo — and is
          not visible to other visitors.
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
          &ldquo;Meridian Health&rdquo; is a fictional payer and every record in the
          demo is synthetic. No timeline for a reply is promised.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className={cn(buttonVariants({ size: "sm" }))}>
          Back to home
        </Link>
        <Link
          href="/initiatives/new"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
        >
          Try the demo while you wait
        </Link>
      </div>
    </main>
  );
}
