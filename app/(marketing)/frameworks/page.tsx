import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FRAMEWORK_PAGES } from "@/lib/marketing/framework-mappings";

export const metadata = {
  title: "Framework crosswalks — Jeeves",
  description:
    "How the Jeeves demo control catalog maps to the NIST AI RMF and the EU AI Act.",
};

// Index of the framework crosswalks (/frameworks/nist-ai-rmf,
// /frameworks/eu-ai-act) — two static pages, no dynamic [framework] param
// needed for a two-entry catalog (FRAMEWORK_PAGES).
export default function FrameworksIndexPage() {
  return (
    <section className="bg-background py-16 md:py-20">
      <div className="mx-auto max-w-[72rem] px-6">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Framework crosswalks
        </h1>
        <p className="mt-3 max-w-[60ch] text-sm text-muted-foreground md:text-base">
          Where the Jeeves demo&rsquo;s control catalog does the work of
          common AI governance frameworks.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {FRAMEWORK_PAGES.map((page) => (
            <Card key={page.slug}>
              <CardHeader>
                <CardTitle>{page.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {page.intro.split(". ")[0]}.
                </p>
                <Link
                  href={`/frameworks/${page.slug}`}
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  View the crosswalk →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
