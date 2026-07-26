import Link from "next/link";
import {
  ShieldCheck,
  Inbox,
  ClipboardCheck,
  Activity,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_BANNER_TEXT } from "@/lib/demo-banner";
import { cn } from "@/lib/utils";

/**
 * Public marketing landing page at "/" — pure presentational server
 * component (no hooks, no data fetching, synchronous) so it renders without
 * any of the console's providers (RoleProvider/LiveSessionProvider/etc).
 * The real operations console (sidebar + top bar + Inbox dashboard) now
 * lives under app/(console)/, starting at /inbox — see
 * app/(console)/layout.tsx and app/(console)/inbox/page.tsx.
 *
 * Every link on this page points at a real console route (/inbox,
 * /portfolio, /reviews, /controls, /monitoring, /audit) — no fake
 * integrations, no dead links, no forms, no mutations.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* a) Demo disclaimer strip — same visual language as the console's
          app-topbar strip, rendering the shared DEMO_BANNER_TEXT constant. */}
      <div className="bg-amber-100 px-4 py-1 text-center text-[11px] font-medium text-amber-900 dark:bg-amber-950/70 dark:text-amber-200">
        {DEMO_BANNER_TEXT}
      </div>

      {/* b) + c): header row and hero, both on the dark charcoal surface. */}
      <div className="relative overflow-hidden bg-sidebar text-sidebar-foreground">
        {/* Subtle decorative dot grid — quiet, no color, purely textural. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative mx-auto flex max-w-[72rem] items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold">Jeeves</span>
              <span className="text-[11px] text-sidebar-foreground/60">
                Governance Console
              </span>
            </span>
          </div>
          <Link
            href="/inbox"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            Console
          </Link>
        </div>

        <div className="relative mx-auto max-w-[72rem] px-6 py-20 md:py-28">
          <span className="inline-flex items-center rounded-full border border-sidebar-primary/40 px-3 py-1 text-xs font-medium text-sidebar-primary">
            Meridian Health · AI Governance Gateway
          </span>

          <h1 className="mt-6 max-w-[20ch] text-4xl font-semibold tracking-tight md:text-6xl">
            Every AI initiative. Governed end to end.
          </h1>

          <p className="mt-6 max-w-[60ch] text-base text-sidebar-foreground/70 md:text-lg">
            Jeeves is the governance gateway for Meridian Health&rsquo;s AI
            portfolio — tiered intake, domain reviews with named accountable
            approvers, deployment controls, and an append-only audit trail,
            in one operations console.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/inbox" className={buttonVariants({ size: "lg" })}>
              Open the console
            </Link>
            <Link
              href="/portfolio"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              Browse the portfolio
            </Link>
          </div>
        </div>

        {/* d) Stats strip — still on the dark surface, directly under the
            hero content, separated by a hairline border. */}
        <div className="relative border-t border-sidebar-border">
          <div className="mx-auto grid max-w-[72rem] grid-cols-2 gap-6 px-6 py-8 sm:grid-cols-4">
            <Stat value="12" label="seeded initiatives" />
            <Stat value="17" label="catalog controls" />
            <Stat value="8" label="review domains" />
            <Stat value="100%" label="decisions audited" />
          </div>
          <p className="relative pb-6 text-center text-[11px] text-sidebar-foreground/50">
            Synthetic data — demo
          </p>
        </div>
      </div>

      {/* e) Feature grid — light surface. */}
      <section className="bg-background py-16 md:py-20">
        <div className="mx-auto max-w-[72rem] px-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            One console for the whole governance loop
          </h2>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FeatureCard
              icon={Inbox}
              title="Intake & tiering"
              description="Structured intake with automatic risk tiering routes every initiative to the right review depth."
              href="/portfolio"
              linkLabel="View portfolio"
            />
            <FeatureCard
              icon={ClipboardCheck}
              title="Domain reviews"
              description="Agents draft, named reviewers sign, and an accountable approver decides. Agents never approve."
              href="/reviews"
              linkLabel="View reviews"
            />
            <FeatureCard
              icon={ShieldCheck}
              title="Controls & exceptions"
              description="Effective controls generated per decision, with time-boxed, named exceptions."
              href="/controls"
              linkLabel="View controls"
            />
            <FeatureCard
              icon={Activity}
              title="Monitoring & audit"
              description="Live telemetry against thresholds and an append-only audit trail of every event."
              href="/audit"
              linkLabel="View audit"
            />
          </div>
        </div>
      </section>

      {/* f) How it works band. */}
      <section className="border-t bg-muted/40 py-16">
        <div className="mx-auto max-w-[72rem] px-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            How it works
          </h2>

          <div className="mt-8 grid gap-8 sm:grid-cols-3">
            <Step
              number="01"
              title="Intake"
              description="Describe the initiative; Jeeves scores risk and assigns a tier."
            />
            <Step
              number="02"
              title="Review"
              description="Required domains fan out; reviewers sign with full context."
            />
            <Step
              number="03"
              title="Operate"
              description="Deploy with controls, monitor thresholds, audit everything."
            />
          </div>
        </div>
      </section>

      {/* g) Final CTA band — dark again. */}
      <section className="bg-sidebar py-16 text-center text-sidebar-foreground">
        <div className="mx-auto max-w-[40rem] px-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Explore the demo
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground/70">
            Public visitors are read-only. Live actions require the demo
            passcode.
          </p>
          <div className="mt-6">
            <Link href="/inbox" className={buttonVariants({ size: "lg" })}>
              Enter the console
            </Link>
          </div>
        </div>
      </section>

      {/* h) Footer — same string the console footer uses. */}
      <footer className="border-t px-5 py-4 text-center text-xs text-muted-foreground">
        Fictional demo. Synthetic data only. Not affiliated with any real
        organization.
      </footer>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-3xl font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-xs text-sidebar-foreground/60">{label}</div>
    </div>
  );
}

function Step({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="font-mono text-sm text-muted-foreground">{number}</div>
      <h3 className="mt-2 text-base font-medium">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  linkLabel,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <Card>
      <CardHeader>
        <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-accent-foreground">
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <CardTitle className="mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Link
          href={href}
          className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
        >
          {linkLabel} →
        </Link>
      </CardContent>
    </Card>
  );
}
