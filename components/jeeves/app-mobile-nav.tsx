"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./app-sidebar";

/**
 * Mobile nav strip — the console's AppSidebar is `hidden` below `md` (see
 * components/jeeves/app-sidebar.tsx), which left small screens with no way
 * to reach any route but the one currently loaded. This renders the same
 * NAV_ITEMS as a horizontally scrollable strip of pill links directly under
 * the top bar, `md:hidden` so it disappears once the sidebar takes over.
 *
 * Active-item logic mirrors AppSidebar exactly (exact match for Inbox,
 * prefix match for everything else) so the two never disagree about which
 * route is "current."
 */
export function AppMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="flex gap-1.5 overflow-x-auto border-b bg-card px-3 py-2 md:hidden"
    >
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
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors ${
              active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
