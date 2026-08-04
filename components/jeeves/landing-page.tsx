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
import { CONTACT_URL } from "@/lib/marketing/site-config";
import { cn } from "@/lib/utils";

/**
 * Public marketing landing page at "/" — pure presentational server
 * component (no hooks, no data fetching, synchronous) so it renders without
 * any of the console's providers (RoleProvider/LiveSessionProvider/etc).
 * The real operations console (sidebar + top bar + Inbox dashboard) now
 * lives under app/(console)/, starting at /inbox — see
 * app/(console)/layout.tsx and app/(console)/inbox/page.tsx.
 *
 * The demo-disclaimer strip and site header/nav now live in
 * app/(marketing)/layout.tsx (shared across "/", "/frameworks", "/pilot"),
 * so this component starts directly with the dark hero band.
 *
 * Positioning: Jeeves the product is pitched for real here; "Meridian
 * Health" is the clearly-labeled fictional demo scenario visitors can click
 * into. No invented clients, testimonials, metrics, or prices — every link
 * on this page points at a real route (/inbox, /portfolio, /frameworks,
 * /pilot, or CONTACT_URL) — no fake integrations, no dead links, no forms,
 * no mutations.
 *
 * Instrument-deck pass (2026-08-03): re-tuned onto the console's design
 * language (app/globals.css — read that file first for the full rationale)
 * so the front door reads as the same machine as the console rather than an
 * older, generic marketing look:
 *  - petrol-ink / cool-paper tokens throughout, never a raw hex or a stock
 *    Tailwind color;
 *  - the mono data voice (.kicker / .label-mono / .stat-value) for eyebrows,
 *    labels and figures — Sora stays reserved for the two display headings,
 *    Inter carries prose;
 *  - the feature grid and how-it-works band are one hairline-divided panel
 *    each (.panel), not floating rounded cards — matching
 *    OutcomeMetricsStrip's "one instrument, not a pile of tiles" rule;
 *  - the governance-loop schematic's connector strokes were re-measured and
 *    raised off a 2.1-2.2:1 audit finding (see contrast table in the PR/
 *    session notes) to clear the 3:1 bar for meaningful graphics, and its
 *    node labels moved from the display face onto mono, and the
 *    accent-highlighted "Decision" node moved off a solid-fill + reversed-
 *    text treatment (which measured under 2:1 in the light theme's teal)
 *    onto a tinted/outlined treatment that reads correctly in both themes.
 */
export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Hero on the dark instrument-panel surface (the sidebar tokens) — a
          deliberate fixed-dark band, same choice the console makes for its
          own nav rail in either theme. The demo strip and site header/nav
          live in app/(marketing)/layout.tsx, shared by every marketing
          route. */}
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

        <div className="relative mx-auto grid max-w-[72rem] gap-12 px-6 py-20 md:py-28 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-8">
          {/* Left: kicker, headline, subcopy, CTAs. */}
          <div>
            <p className="kicker flex items-center gap-2 text-sidebar-foreground-muted">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-primary"
                aria-hidden
              />
              AI Governance Gateway for Healthcare AI
            </p>

            <h1 className="mt-6 max-w-[18ch] text-5xl leading-[1.05] font-semibold tracking-tight md:text-6xl lg:text-[3.75rem]">
              Every AI initiative.{" "}
              <span className="text-sidebar-primary">
                Governed end to end.
              </span>
            </h1>

            <p className="mt-6 max-w-[64ch] text-base leading-relaxed text-sidebar-foreground-muted md:text-lg">
              Jeeves gives healthcare AI portfolios a governance operating
              system — tiered intake, domain reviews with named accountable
              approvers, deployment controls, and an append-only audit
              trail. Explore it live against a fictional payer with fully
              synthetic data.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={CONTACT_URL}
                className={cn(buttonVariants({ size: "lg" }), "group gap-2")}
              >
                Book a governance assessment
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-(--motion-base) ease-(--motion-ease) group-hover:translate-x-0.5"
                  aria-hidden
                />
              </Link>
              <Link
                href="/inbox"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "border-sidebar-border bg-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                Explore the live demo
              </Link>
            </div>
          </div>

          {/* Right: the governance loop schematic — the product story in
              one diagram. Hidden below lg so it never competes with the
              headline on narrow viewports. */}
          <div className="hidden lg:flex lg:items-center lg:justify-center">
            <div className="relative w-full max-w-[420px] rounded-[var(--radius)] border border-sidebar-border bg-sidebar-accent/20 p-6">
              <div
                className="ticks pointer-events-none absolute inset-y-0 left-0 w-px"
                aria-hidden
              />
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
          <p className="label-mono relative pb-6 text-center text-sidebar-foreground-muted">
            Synthetic data — demo
          </p>
        </div>
      </div>

      {/* e) Feature grid — light surface, one hairline-divided panel rather
          than four floating rounded cards (same grammar as
          OutcomeMetricsStrip on the console's Inbox). */}
      <section className="bg-background py-16 md:py-20">
        <div className="mx-auto max-w-[72rem] px-6">
          <p className="kicker text-primary">What&rsquo;s inside</p>
          <h2 className="mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl">
            One console for the whole governance loop
          </h2>

          <div className="panel card-quiet mt-8 grid grid-cols-1 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <FeatureCard
              index="01"
              icon={Inbox}
              title="Intake & tiering"
              description="Structured intake with automatic risk tiering routes every initiative to the right review depth."
              href="/portfolio"
              linkLabel="View portfolio"
            />
            <FeatureCard
              index="02"
              icon={ClipboardCheck}
              title="Domain reviews"
              description="Agents draft, named reviewers sign, and an accountable approver decides. Agents never approve."
              href="/reviews"
              linkLabel="View reviews"
            />
            <FeatureCard
              index="03"
              icon={ShieldCheck}
              title="Controls & exceptions"
              description="Effective controls generated per decision, with time-boxed, named exceptions."
              href="/controls"
              linkLabel="View controls"
            />
            <FeatureCard
              index="04"
              icon={Activity}
              title="Monitoring & audit"
              description="Live telemetry against thresholds and an append-only audit trail of every event."
              href="/audit"
              linkLabel="View audit"
            />
          </div>
        </div>
      </section>

      {/* f0) Built for both sides of procurement — payer buyers and vendor
          sellers each get a card pointing at the crosswalk that matters to
          them. */}
      <section className="border-t bg-background py-16">
        <div className="mx-auto max-w-[72rem] px-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            Built for both sides of procurement
          </h2>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Health plans &amp; providers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Govern the AI portfolio end to end: intake to audit, a
                  HIPAA-aware control catalog, and named accountability at
                  every decision.
                </p>
                <Link
                  href="/frameworks"
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  See the framework crosswalk →
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>AI vendors selling into healthcare</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Arrive procurement-ready: mapped controls, an evidence
                  pack, and a live governance story instead of a blank
                  security questionnaire.
                </p>
                <Link
                  href="/pilot"
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  See the pilot →
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* f) How it works band — same hairline-panel grammar as the feature
          grid above, divided into three cells instead of a floating
          connector line. */}
      <section className="border-t bg-muted/40 py-16">
        <div className="mx-auto max-w-[72rem] px-6">
          <p className="kicker text-primary">Sequence</p>
          <h2 className="mt-1.5 text-2xl font-semibold tracking-tight md:text-3xl">
            How it works
          </h2>

          <div className="panel card-quiet mt-8 grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
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

      {/* f1) Slim frameworks band before the final CTA. */}
      <section className="border-t bg-background py-10 text-center">
        <div className="mx-auto max-w-[72rem] px-6">
          <h2 className="text-base font-medium text-muted-foreground">
            Mapped to the frameworks your reviewers ask about
          </h2>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
            <Link
              href="/frameworks/nist-ai-rmf"
              className="text-sm font-medium text-primary hover:underline"
            >
              NIST AI RMF crosswalk →
            </Link>
            <Link
              href="/frameworks/eu-ai-act"
              className="text-sm font-medium text-primary hover:underline"
            >
              EU AI Act crosswalk →
            </Link>
          </div>
        </div>
      </section>

      {/* g) Final CTA band — dark again. */}
      <section className="bg-sidebar py-16 text-center text-sidebar-foreground">
        <div className="mx-auto max-w-[40rem] px-6">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">
            See it live
          </h2>
          <p className="mt-3 text-sm text-sidebar-foreground-muted">
            Public visitors are read-only. Live actions require the demo
            passcode.
          </p>
          <div className="mt-6">
            <Link href="/inbox" className={buttonVariants({ size: "lg" })}>
              Explore the live demo
            </Link>
          </div>
        </div>
      </section>
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
    <div className="flex flex-col gap-1.5 p-6">
      <div className="stat-value text-lg text-primary">{number}</div>
      <h3 className="text-base font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function FeatureCard({
  index,
  icon: Icon,
  title,
  description,
  href,
  linkLabel,
}: {
  index: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="group/feature flex flex-col gap-2 p-6">
      <div className="flex items-center justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-accent text-accent-foreground transition-transform duration-(--motion-base) ease-(--motion-ease) group-hover/feature:scale-105">
          <Icon className="h-4.5 w-4.5" aria-hidden />
        </span>
        <span className="label-mono text-muted-foreground">{index}</span>
      </div>
      <h3 className="mt-1 font-heading text-base font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      <Link
        href={href}
        className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        {linkLabel}
        <span
          aria-hidden
          className="transition-transform duration-(--motion-base) ease-(--motion-ease) group-hover/feature:translate-x-1"
        >
          →
        </span>
      </Link>
    </div>
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
 *
 * Instrument-deck pass: connector strokes were re-measured against the dark
 * hero ground and raised off a 2.1-2.2:1 audit finding — main connectors now
 * sit at sidebar-foreground/55 (5.54:1) and the return path at /50 (4.79:1),
 * both clearing the 3:1 bar for meaningful graphics. Node labels moved from
 * the display face (Sora) onto the mono data voice, matching every other
 * label/ID in the console.
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
          <path d="M0,0 L8,4 L0,8 Z" className="fill-sidebar-foreground/55" />
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
        className="stroke-sidebar-foreground/55"
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
        className="stroke-sidebar-foreground/50"
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
  // Accent ("Decision") reads as a tinted/outlined instrument highlight
  // rather than a solid-fill block with reversed text: sidebar-primary
  // paired with sidebar-primary-foreground measures under 2:1 in the light
  // theme (bright teal + near-white text), so the emphasis node instead
  // keeps the same dark ground as every other node and draws its text
  // directly in sidebar-primary — 8.23:1 (light) / 5.56:1 (dark) against
  // the sidebar-accent node fill, both themes.
  const rectClass =
    variant === "accent"
      ? "fill-sidebar-primary/12 stroke-sidebar-primary"
      : variant === "warning"
        ? "fill-sidebar-accent stroke-status-warning/50"
        : "fill-sidebar-accent stroke-sidebar-border";
  const titleClass =
    variant === "accent"
      ? "fill-sidebar-primary font-mono font-semibold"
      : small
        ? "fill-sidebar-foreground/85 font-mono"
        : "fill-sidebar-foreground font-mono font-medium";
  const subtitleClass =
    variant === "accent"
      ? "fill-sidebar-primary/80 font-mono"
      : "fill-sidebar-foreground/60 font-mono";

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={small ? 5 : 7}
        className={rectClass}
        strokeWidth={variant === "accent" ? "2" : "1.5"}
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
