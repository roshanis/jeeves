"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutList,
  ClipboardCheck,
  Activity,
  ShieldCheck,
  ScrollText,
  GitPullRequestArrow,
  Settings2,
} from "lucide-react";

// Governance Operations Console navigation (Codex design review): a charcoal
// left rail, not a marketing top-nav. Inbox is the working dashboard; every
// route stays visible to all roles (role changes ACTIONS, not access — §0/§11).
const NAV_ITEMS = [
  { href: "/", label: "Inbox", icon: Inbox, exact: true },
  { href: "/portfolio", label: "Portfolio", icon: LayoutList },
  { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/controls", label: "Controls", icon: ShieldCheck },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/promotions", label: "Promotions", icon: GitPullRequestArrow },
  { href: "/admin", label: "Administration", icon: Settings2 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
      <Link
        href="/"
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

      <nav className="flex flex-1 flex-col gap-0.5 p-3">
        {NAV_ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] text-sidebar-foreground/50">
        Meridian Health · synthetic demo workspace
      </div>
    </aside>
  );
}
