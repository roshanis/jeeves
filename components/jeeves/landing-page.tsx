import Link from "next/link";
import {
  ShieldCheck,
  Inbox,
  ClipboardCheck,
  Activity,
  ArrowRight,
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

        <div className="relative mx-auto grid max-w-[72rem] gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8">
          {/* Left: kicker, headline, subcopy, CTAs. */}
          <div>
            <span className="inline-flex items-center rounded-full border border-sidebar-primary/40 px-3 py-1 text-xs font-medium text-sidebar-primary">
              Meridian Health · AI Governance Gateway
            </span>

            <h1 className="mt-7 max-w-[18ch] text-5xl leading-[1.05] font-semibold tracking-tight md:text-6xl lg:text-[3.75rem]">
              Every AI initiative.{" "}
              <span className="text-sidebar-primary">
                Governed end to end.
              </span>
            </h1>

            <p className="mt-6 max-w-[46ch] text-base leading-relaxed text-sidebar-foreground/70 md:text-lg">
              Jeeves is the governance gateway for Meridian Health&rsquo;s AI
              portfolio — tiered intake, domain reviews with named
              accountable approvers, deployment controls, and an
              append-only audit trail, in one operations console.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/inbox"
                className={cn(buttonVariants({ size: "lg" }), "group gap-2")}
              >
                Open the console
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
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

          {/* Right: the governance loop schematic — the product story in
              one diagram. Hidden below lg so it never competes with the
              headline on narrow viewports. */}
          <div className="hidden lg:flex lg:items-center lg:justify-center">
            <div className="w-full max-w-[420px] rounded-2xl border border-sidebar-border/70 bg-sidebar-accent/15 p-6">
              <GovernanceLoopDiagram />
            </div>
          </div>
        </div>

        {/* d) Stats strip — still on the dark surface, directly under the
            hero content, separated by a hairline border. */}
        <div className="relative border-t border-sidebar-border">
          <div className="mx-auto grid max-w-[72rem] grid-cols-2 gap-y-6 px-6 py-8 sm:grid-cols-4 sm:gap-0 sm:divide-x sm:divide-sidebar-border">
            <Stat value="12" label="seeded initiatives" />
            <Stat value="17" label="catalog controls" />
            <Stat value="8" label="review domains" />
            <Stat value="100%" label="decisions audited" />
          </div>
          <p className="relative pb-6 text-center text-[11px] text-sidebar-foreground-muted">
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

          <div className="relative mt-10">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-[16.6%] top-[18px] hidden h-px bg-border sm:block"
            />
            <div className="grid gap-8 sm:grid-cols-3">
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
    <div className="px-0 sm:px-5 first:sm:pl-0">
      <div className="stat-value text-3xl text-sidebar-foreground md:text-4xl">
        {value}
      </div>
      <div className="kicker mt-1.5 text-sidebar-foreground-muted">{label}</div>
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
    <div className="relative">
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background font-mono text-sm font-semibold text-foreground">
        {number}
      </div>
      <h3 className="mt-4 text-base font-medium">{title}</h3>
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
    <Card className="group/feature shadow-card transition-shadow duration-200 hover:shadow-raised">
      <CardHeader>
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground transition-transform duration-200 group-hover/feature:scale-105">
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <CardTitle className="mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {linkLabel}
          <span
            aria-hidden
            className="transition-transform duration-200 group-hover/feature:translate-x-1"
          >
            →
          </span>
        </Link>
      </CardContent>
    </Card>
  );
}

/**
 * The 8 governance domains (lib/domain/types.ts) laid out as a two-row fan
 * beneath Triage, in short label form so each fits its node at 11px.
 * col: 0-3 left-to-right, row: 0 = upper, 1 = lower.
 */
const DOMAIN_NODES = [
  { label: "Legal", col: 0, row: 0 },
  { label: "Tech", col: 1, row: 0 },
  { label: "Security", col: 2, row: 0 },
  { label: "Clinical", col: 3, row: 0 },
  { label: "Procurement", col: 0, row: 1 },
  { label: "Resp. AI", col: 1, row: 1 },
  { label: "Privacy", col: 2, row: 1 },
  { label: "Data Gov.", col: 3, row: 1 },
] as const;

const DOMAIN_COL_X = [50, 150, 250, 350];
const DOMAIN_ROW_Y = [114, 154];
const NODE_W = 84;
const NODE_H = 24;

/**
 * Inline-SVG schematic of the governance loop: Intake → Triage → the 8
 * domain review nodes fan out → Decision (named approver, highlighted) →
 * Effective controls → Monitor, with a dashed breach path looping back to
 * Reassess and a return path back into Decision. This is the product
 * story, not decoration — every node name is a real step in the app.
 */
function GovernanceLoopDiagram() {
  return (
    <svg
      viewBox="0 0 400 460"
      className="h-auto w-full text-sidebar-foreground"
      role="img"
      aria-label="Governance loop diagram"
    >
      <title>Governance loop diagram</title>
      <defs>
        <marker
          id="gl-arrow"
          viewBox="0 0 8 8"
          refX="6.5"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-sidebar-foreground/45" />
        </marker>
        <marker
          id="gl-arrow-warning"
          viewBox="0 0 8 8"
          refX="6.5"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 Z" className="fill-status-warning" />
        </marker>
      </defs>

      {/* Connectors — drawn first so nodes sit on top. */}
      <g
        fill="none"
        className="stroke-sidebar-foreground/30"
        strokeWidth="1.5"
      >
        {/* Intake -> Triage */}
        <line x1="200" y1="38" x2="200" y2="62" markerEnd="url(#gl-arrow)" />
        {/* Triage -> fan-out bus */}
        <line x1="200" y1="92" x2="200" y2="102" />
        <line x1="50" y1="102" x2="350" y2="102" />
        {DOMAIN_COL_X.map((x) => (
          <line key={`drop-${x}`} x1={x} y1="102" x2={x} y2="114" />
        ))}
        {/* Column connectors: row 0 -> row 1 */}
        {DOMAIN_COL_X.map((x) => (
          <line key={`col-${x}`} x1={x} y1="138" x2={x} y2="154" />
        ))}
        {/* Fan-out -> converge bus -> Decision */}
        {DOMAIN_COL_X.map((x) => (
          <line key={`conv-${x}`} x1={x} y1="178" x2={x} y2="190" />
        ))}
        <line x1="50" y1="190" x2="350" y2="190" />
        <line
          x1="200"
          y1="190"
          x2="200"
          y2="202"
          markerEnd="url(#gl-arrow)"
        />
        {/* Decision -> Effective controls -> Monitor */}
        <line x1="200" y1="240" x2="200" y2="252" markerEnd="url(#gl-arrow)" />
        <line x1="200" y1="282" x2="200" y2="294" markerEnd="url(#gl-arrow)" />
      </g>

      {/* Breach path: Monitor -> Reassess, dashed, warning color. */}
      <path
        d="M200,324 C200,352 140,352 100,372"
        fill="none"
        className="stroke-status-warning"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        markerEnd="url(#gl-arrow-warning)"
      />

      {/* Return path: Reassess back into Decision, closing the loop. */}
      <path
        d="M40,388 C6,388 6,221 130,221"
        fill="none"
        className="stroke-sidebar-foreground/25"
        strokeWidth="1.25"
        markerEnd="url(#gl-arrow)"
      />

      {/* Nodes. */}
      <SchematicNode x={148} y={8} w={104} h={30} title="Intake" />
      <SchematicNode x={148} y={62} w={104} h={30} title="Triage" />

      {DOMAIN_NODES.map((node) => (
        <SchematicNode
          key={node.label}
          x={DOMAIN_COL_X[node.col] - NODE_W / 2}
          y={DOMAIN_ROW_Y[node.row]}
          w={NODE_W}
          h={NODE_H}
          title={node.label}
          small
        />
      ))}

      <SchematicNode
        x={130}
        y={202}
        w={140}
        h={38}
        title="Decision"
        subtitle="Named approver"
        variant="accent"
      />
      <SchematicNode
        x={120}
        y={252}
        w={160}
        h={30}
        title="Effective controls"
      />
      <SchematicNode x={145} y={294} w={110} h={30} title="Monitor" />
      <SchematicNode
        x={40}
        y={372}
        w={120}
        h={32}
        title="Reassess"
        subtitle="on breach"
        variant="warning"
      />
    </svg>
  );
}

function SchematicNode({
  x,
  y,
  w,
  h,
  title,
  subtitle,
  variant = "default",
  small = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  variant?: "default" | "accent" | "warning";
  small?: boolean;
}) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rectClass =
    variant === "accent"
      ? "fill-sidebar-primary stroke-sidebar-primary"
      : variant === "warning"
        ? "fill-sidebar-accent stroke-status-warning/50"
        : "fill-sidebar-accent stroke-sidebar-border";
  const titleClass =
    variant === "accent"
      ? "fill-sidebar-primary-foreground font-heading font-medium"
      : small
        ? "fill-sidebar-foreground/85"
        : "fill-sidebar-foreground font-heading font-medium";
  const subtitleClass =
    variant === "accent"
      ? "fill-sidebar-primary-foreground/80"
      : "fill-sidebar-foreground/60";

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={small ? 5 : 7}
        className={rectClass}
        strokeWidth="1.5"
      />
      {subtitle ? (
        <>
          <text
            x={cx}
            y={cy - 5}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="11"
            className={titleClass}
          >
            {title}
          </text>
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="9"
            className={subtitleClass}
          >
            {subtitle}
          </text>
        </>
      ) : (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          className={titleClass}
        >
          {title}
        </text>
      )}
    </g>
  );
}
