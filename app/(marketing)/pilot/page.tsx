import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FRAMEWORK_DISCLAIMER } from "@/lib/marketing/framework-mappings";
import { CONTACT_URL, PILOT_PRICE } from "@/lib/marketing/site-config";

export const metadata = {
  title: "Procurement-readiness pilot — Jeeves",
  description:
    "A 4-6 week pilot that gets AI teams selling into health plans and health systems procurement-ready: mapped controls, a governance console, and an evidence pack.",
};

const DELIVERABLES = [
  {
    title: "Mapped control catalog",
    description:
      "Your product's controls mapped to NIST AI RMF and the EU AI Act, in the same crosswalk format buyers see on this site.",
  },
  {
    title: "A governance console instance",
    description:
      "Your initiatives, reviews, and an append-only audit trail — running in a real Jeeves instance, not a slide deck.",
  },
  {
    title: "A procurement evidence pack",
    description:
      "Answers to the security/AI-questionnaire sections buyers ask most often, packaged and ready to send.",
  },
  {
    title: "A gap list with named owners",
    description:
      "Anything not yet in place, with a named owner and a date — no open-ended \"we'll get to it.\"",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Scoping call",
    description: "We map your product, your buyers, and the frameworks they ask about.",
  },
  {
    number: "02",
    title: "Mapping + console setup",
    description:
      "Your controls get mapped and loaded into a working console instance.",
  },
  {
    number: "03",
    title: "Evidence-pack handoff",
    description:
      "You leave with the control mapping, the console, and the evidence pack ready to send to a buyer.",
  },
];

// Procurement-readiness pilot one-pager — pitches the real Jeeves product to
// AI vendors selling into healthcare (not tied to the fictional Meridian
// Health scenario). No invented clients, testimonials, metrics, or prices:
// PILOT_PRICE renders "Contact for pricing" until a real number is set.
// Print-clean (no dark bands) so it doubles as a handoff one-pager under
// the marketing layout's print CSS.
export default function PilotPage() {
  return (
    <div className="bg-background">
      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-[60rem] px-6">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Procurement-readiness pilot
          </h1>
          <p className="mt-3 text-base text-muted-foreground md:text-lg">
            For AI teams selling into health plans and health systems.
          </p>

          <div className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">
              The problem
            </h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              Procurement and security review stalls AI deals in healthcare —
              buyers ask for governance evidence most vendors don&rsquo;t have
              packaged: control mappings, named owners, an audit trail. Building
              that from scratch, mid-deal, costs weeks you don&rsquo;t have.
            </p>
          </div>

          <div className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">
              What you get (4-6 weeks)
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {DELIVERABLES.map((item) => (
                <Card key={item.title}>
                  <CardHeader>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {item.description}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">
              How it runs
            </h2>
            <div className="mt-4 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.number}>
                  <div className="font-mono text-sm text-muted-foreground">
                    {step.number}
                  </div>
                  <h3 className="mt-2 text-base font-medium">{step.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">Pricing</h2>
            <p className="mt-3 text-sm text-muted-foreground md:text-base">
              {PILOT_PRICE ?? "Contact for pricing"}
            </p>
          </div>

          <div className="mt-10 border-t pt-8">
            <Link href={CONTACT_URL} className={buttonVariants({ size: "lg" })}>
              Book an intro call
            </Link>
          </div>

          <p className="mt-10 text-[11px] text-muted-foreground/70">
            {FRAMEWORK_DISCLAIMER}
          </p>
        </div>
      </section>
    </div>
  );
}
