"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  NAV_SECTIONS,
  ADMIN_NAV_ITEM,
  isNavItemActive,
  type NavItem,
} from "./nav-items";
import { ShieldCheck } from "lucide-react";

// Governance Operations Console navigation (Codex design review): a charcoal
// left rail, not a marketing top-nav. Inbox is the working dashboard; every
// route stays visible to all roles (role changes ACTIONS, not access — §0/§11).
// Inbox lives at /inbox — "/" is the public marketing landing page.
//
// The nav DATA now lives in ./nav-items.ts, a module with no "use client"
// boundary, because server components need it too (app/(console)/not-found.tsx
// links to every section). A plain value imported from a client module into a
// server component arrives as a client-reference proxy, not the value. These
// re-exports keep every existing importer of app-sidebar working unchanged.
export {
  NAV_ITEMS,
  NAV_SECTIONS,
  ADMIN_NAV_ITEM,
  isNavItemActive,
  type NavItem,
} from "./nav-items";

// Active state reads as a machined selection rather than a plain highlight:
// a full-height 2px signal rail flush to the rail's outer edge, plus a
// subtle inset panel (hairline ring) so the selected row looks seated into
// the chassis instead of just tinted. Both layers ride the same duration so
// hover/active/focus feel like one instrument (motion tokens, globals.css).
function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex h-11 items-center gap-2.5 px-3 text-sm transition-colors duration-(--motion-base) ease-(--motion-ease) before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:content-[''] ${
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)] before:bg-sidebar-primary"
          : "text-sidebar-foreground-muted before:bg-transparent hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="relative hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      {/* Calibration edge on the rail's outer border — decorative only. */}
      <div className="ticks pointer-events-none absolute inset-y-0 right-0 w-px" aria-hidden />
      <Link
        href="/inbox"
        className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4"
      >
        <span className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Jeeves</span>
          <span className="text-[11px] text-sidebar-foreground-muted">
            Governance Console
          </span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3 scroll-thin">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="flex flex-col gap-0.5">
            <p className="kicker px-3 pt-3 pb-1.5 text-sidebar-foreground-muted first:pt-1">
              {section.label}
            </p>
            {section.items.map((item) => (
              <SidebarLink key={item.href} item={item} active={isNavItemActive(item, pathname)} />
            ))}
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-0.5 border-t border-sidebar-border/60 pt-2">
          <SidebarLink item={ADMIN_NAV_ITEM} active={isNavItemActive(ADMIN_NAV_ITEM, pathname)} />
        </div>
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-sidebar-foreground">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-status-good" aria-hidden />
          Meridian Health
        </div>
        <div className="pl-3 text-[10.5px] leading-snug text-sidebar-foreground-muted">
          Synthetic demo workspace
        </div>
      </div>
    </aside>
  );
}
