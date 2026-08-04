import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { FrameworkMappingTable } from "@/components/jeeves/framework-mapping-table";
import { FRAMEWORK_PAGES } from "@/lib/marketing/framework-mappings";
import { CONTACT_URL } from "@/lib/marketing/site-config";

const page = FRAMEWORK_PAGES.find((p) => p.slug === "nist-ai-rmf")!;

export const metadata = {
  title: `${page.title} — Jeeves`,
  description: page.intro,
};

export default function NistAiRmfCrosswalkPage() {
  return (
    <section className="bg-background py-16 md:py-20">
      <div className="mx-auto max-w-[72rem] px-6">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          {page.title}
        </h1>
        <p className="mt-3 max-w-[70ch] text-sm text-muted-foreground md:text-base">
          {page.intro}
        </p>

        <div className="mt-10">
          <FrameworkMappingTable page={page} />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 border-t pt-8">
          <Link href={CONTACT_URL} className={buttonVariants({ size: "lg" })}>
            Book a governance assessment
          </Link>
          <Link
            href="/inbox"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Explore the live demo
          </Link>
        </div>
      </div>
    </section>
  );
}
