import Link from "next/link";
import {
  ArrowRight,
  FileInput,
  ShieldQuestion,
  GitPullRequestArrow,
  BadgeCheck,
  Activity,
  RotateCcw,
  Scale,
  ShoppingCart,
  Building2,
  BrainCircuit,
  Lock,
  HeartPulse,
  Database,
  Stethoscope,
} from "lucide-react";
import { getAppProvider } from "@/app/_lib/data-provider";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const LIFECYCLE = [
  { icon: FileInput, label: "Intake", note: "Structured request + completeness check" },
  { icon: ShieldQuestion, label: "Triage", note: "Deterministic risk tiering" },
  { icon: GitPullRequestArrow, label: "Review", note: "Agents draft, humans decide" },
  { icon: BadgeCheck, label: "Approve", note: "Named accountable approver" },
  { icon: Activity, label: "Operate", note: "Continuous eval monitoring" },
  { icon: RotateCcw, label: "Reassess", note: "Breach reopens review" },
];

const DOMAINS = [
  { icon: Scale, label: "Legal" },
  { icon: ShoppingCart, label: "Procurement" },
  { icon: Building2, label: "Tech Architecture" },
  { icon: BrainCircuit, label: "Responsible AI" },
  { icon: Lock, label: "Security" },
  { icon: HeartPulse, label: "Privacy / HIPAA" },
  { icon: Stethoscope, label: "Clinical Safety" },
  { icon: Database, label: "Data Governance" },
];

const PERSONAS = [
  { title: "Requesters", body: "Submit an AI project through one structured front door — no more chasing five committees." },
  { title: "Reviewers", body: "Open a pre-drafted assessment with policy citations already attached. Edit and sign." },
  { title: "Program office", body: "See the whole pipeline, SLAs, and risk heatmap in a single command center." },
  { title: "Audit & leadership", body: "Ask “which member-facing AI touches PHI, and who approved it?” — answered with evidence." },
  { title: "Admin", body: "Tune eval thresholds and pause deployments. Never approves — separation of duties is enforced." },
];

export default async function LandingPage() {
  const provider = getAppProvider();
  const [initiatives, metrics] = await Promise.all([
    provider.listInitiatives(),
    provider.outcomeMetrics(),
  ]);

  const stats = [
    { value: String(initiatives.length), label: "Initiatives governed" },
    { value: "8", label: "Review domains" },
    { value: `${metrics.medianReviewCycleDays}d`, label: "Median review cycle" },
    { value: `${metrics.firstPassCompletenessPct}%`, label: "First-pass completeness" },
  ];

  return (
    <div className="flex flex-col gap-20 pb-8">
      {/* Hero */}
      <section className="-mx-4 -mt-6 bg-hero-gradient px-4 pb-16 pt-16 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
            <ShieldQuestion className="h-3.5 w-3.5" aria-hidden />
            AI Governance Gateway · Meridian Health
          </span>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
            One front door for <span className="text-gradient">every AI project</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            Submit a request, and agents triage risk, draft reviews across eight
            governance domains, and route it to the right humans — then keep
            watching after launch. <strong className="text-foreground">Approval
            isn&rsquo;t the end. It&rsquo;s a checkpoint.</strong>
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
              Enter the console <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
            <Link
              href="/initiatives/new"
              className={buttonVariants({ size: "lg", variant: "outline" })}
            >
              Submit an initiative
            </Link>
          </div>
        </div>

        {/* Stat band */}
        <div className="mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border bg-card/70 px-4 py-3 text-center shadow-sm backdrop-blur"
            >
              <div className="text-2xl font-semibold tabular-nums text-primary">
                {s.value}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Lifecycle loop */}
      <section className="mx-auto w-full max-w-5xl">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Governance as a closed loop
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            Most tools stop at the approval stamp. Jeeves treats it as one
            checkpoint in a loop that keeps running while the model is live.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {LIFECYCLE.map((step, i) => {
            const Icon = step.icon;
            return (
              <Card key={step.label} className="relative">
                <CardContent className="flex flex-col items-center gap-2 px-3 py-5 text-center">
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="text-sm font-semibold">{step.label}</div>
                  <div className="text-xs leading-snug text-muted-foreground">
                    {step.note}
                  </div>
                  <span className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {i + 1}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Personas */}
      <section className="mx-auto w-full max-w-5xl">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Built for everyone in the room
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            One initiative-centric app. Switch roles from the top bar — each sees
            the actions and views that fit their job.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <Card key={p.title}>
              <CardContent className="px-5 py-5">
                <h3 className="font-semibold">{p.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Domains */}
      <section className="mx-auto w-full max-w-5xl">
        <div className="text-center">
          <h2 className="text-2xl font-semibold tracking-tight">
            Eight domains, every high-risk request
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            A critical-tier initiative is reviewed across all eight — each with
            its own policy corpus, controls, and accountable reviewer.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DOMAINS.map((d) => {
            const Icon = d.icon;
            return (
              <div
                key={d.label}
                className="flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3 shadow-sm"
              >
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                <span className="text-sm font-medium">{d.label}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto w-full max-w-4xl">
        <Card className="overflow-hidden border-primary/20 bg-primary text-primary-foreground">
          <CardContent className="flex flex-col items-center gap-5 px-6 py-10 text-center">
            <h2 className="text-2xl font-semibold tracking-tight">
              See the whole loop in one walkthrough
            </h2>
            <p className="max-w-xl text-sm text-primary-foreground/80">
              Open the command center to watch a prior-auth summarizer move from
              intake through eight reviews, conditional approval, a live eval
              breach, and reassessment — all on synthetic data.
            </p>
            <Link
              href="/dashboard"
              className={buttonVariants({ size: "lg", variant: "secondary" })}
            >
              Open the command center <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
