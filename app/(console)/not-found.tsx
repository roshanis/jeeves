import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { NAV_SECTIONS } from "@/components/jeeves/app-sidebar";

// Console 404. Rendered inside app/(console)/layout.tsx, so the sidebar,
// top bar and mobile nav stay put — this is the panel that fills <main>.
//
// Before this file existed, notFound() from a bad initiative or agent slug
// fell through to Next.js's stock "404 / This page could not be found."
// screen: unbranded, and with no way onward except the sidebar. The project
// rule is that nothing in this console is a dead end, so this offers the
// routes a lost operator actually wants.
//
// Deliberately no "go back" button: it would need to be a client component
// for history.back(), and a browser already has one. Real links are better —
// they are crawlable, middle-clickable, and work when history is empty
// (someone pasted a stale link).
export default function ConsoleNotFound() {
  const destinations = NAV_SECTIONS.flatMap((section) => section.items);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 py-16 text-center">
      <span
        className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground"
        aria-hidden
      >
        <FileQuestion className="size-6" />
      </span>

      <div className="flex flex-col gap-2">
        <p className="kicker">404 — not found</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          That record isn&apos;t in this workspace
        </h1>
        <p className="text-sm text-muted-foreground">
          The initiative, agent or page you followed doesn&apos;t exist here. It may
          have been a stale link, or it may belong to a different demo workspace —
          a live session creates its own, isolated from the seeded one.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link href="/inbox" className={buttonVariants({ size: "sm" })}>
          Back to Inbox
        </Link>
        <Link
          href="/portfolio"
          className={buttonVariants({ size: "sm", variant: "outline" })}
        >
          Browse all initiatives
        </Link>
      </div>

      <div className="w-full border-t pt-5">
        <p className="kicker mb-2.5">Or jump to</p>
        <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1.5">
          {destinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="touch-min inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <item.icon className="size-3.5 shrink-0" aria-hidden />
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
