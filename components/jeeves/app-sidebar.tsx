"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutList,
  ClipboardCheck,
  Bot,
  Activity,
  ShieldCheck,
  ScrollText,
  GitPullRequestArrow,
  Settings2,
} from "lucide-react";

// Governance Operations Console navigation (Codex design review): a charcoal
// left rail, not a marketing top-nav. Inbox is the working dashboard; every
// route stays visible to all roles (role changes ACTIONS, not access — §0/§11).
// Inbox now lives at /inbox — "/" is the public marketing landing page
// (components/jeeves/landing-page.tsx), so the console's own "home" link
// must point at the real ops route. Exported so app-mobile-nav.tsx (the
// md:hidden nav strip) reuses the exact same item list instead of drifting.
//
// Flat order is preserved verbatim (routes/labels unchanged) — nothing in
// this repo may depend on NAV_ITEMS ordering changing. NAV_SECTIONS below is
// a purely presentational grouping over the same items, used by both the
// sidebar and the mobile nav strip so the two never disagree about section
// order (design pass 2026-08-01).
export const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox", icon: Inbox, exact: true },
  { href: "/portfolio", label: "Portfolio", icon: LayoutList },
  { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/controls", label: "Controls", icon: ShieldCheck },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/promotions", label: "Promotions", icon: GitPullRequestArrow },
  { href: "/admin", label: "Administration", icon: Settings2 },
];

export type NavItem = (typeof NAV_ITEMS)[number];

function navItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav href: ${href}`);
  return item;
}

// Section groupings (Oversee / Operate / Govern); Administration is pinned
// separately near the bottom of the rail rather than folded into Govern.
export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  { label: "Oversee", items: ["/inbox", "/portfolio", "/reviews"].map(navItem) },
  { label: "Operate", items: ["/agents", "/monitoring", "/promotions"].map(navItem) },
  { label: "Govern", items: ["/controls", "/audit"].map(navItem) },
];

export const ADMIN_NAV_ITEM = navItem("/admin");

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(item.href + "/");
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
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
    <aside className="hidden w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <Link
        href="/inbox"
        className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-4"
      >
        <span className="grid h-8 w-8 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">Jeeves</span>
          <span className="text-[11px] text-sidebar-foreground/60">
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
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-sidebar-foreground/75">
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
