import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { PRIVACY_CONTACT, contactEmailLabel } from "@/lib/marketing/site-config";

/**
 * Shared chrome for the privacy and terms pages.
 *
 * Contact is email only, by decision (2026-09-13). No postal address is
 * shown and none is invented — an invented street address on a privacy
 * policy is worse than an absent one, because a reader cannot tell the
 * invention from the truth. A production deployment serving EU/UK visitors
 * is generally expected to publish one; that is recorded as a gap in
 * docs/production-readiness.md rather than papered over here.
 */
export function LegalPage({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12 sm:py-16">
      <div className="flex flex-col gap-1.5">
        <span className="kicker">Legal</span>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {lastUpdated}</p>
      </div>

      <div
        className="flex gap-3 rounded-lg border border-status-warning-fg/30 bg-status-warning-bg p-4"
        data-slot="legal-draft-notice"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-warning-fg" aria-hidden />
        <div className="text-sm text-status-warning-fg">
          <p className="font-medium">This is a demonstration document, not reviewed legal advice.</p>
          <p className="mt-1">
            It describes accurately what this demo does with data, so it is
            useful as a starting point — but it has not been reviewed by a
            lawyer and must be before this service is used for anything real.
          </p>
        </div>
      </div>

      <div
        className="rounded-lg border border-border bg-muted/40 p-4 text-sm"
        data-slot="legal-contact"
      >
        <p className="font-medium">How to reach us</p>
        <p className="mt-1 text-muted-foreground">
          Email{" "}
          <a
            href={PRIVACY_CONTACT}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {contactEmailLabel(PRIVACY_CONTACT)}
          </a>{" "}
          for anything on this page, including a request to delete something
          you submitted. Email is the only contact point for this
          demonstration — no postal address is published.
        </p>
      </div>

      <div className="flex flex-col gap-6 text-sm leading-relaxed">{children}</div>

      <div className="border-t pt-5 text-sm text-muted-foreground">
        <Link href="/" className="underline underline-offset-4 hover:text-foreground">
          Back to home
        </Link>
      </div>
    </main>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold tracking-tight">{heading}</h2>
      {children}
    </section>
  );
}
