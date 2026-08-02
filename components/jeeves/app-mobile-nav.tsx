"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, ADMIN_NAV_ITEM, isNavItemActive, type NavItem } from "./app-sidebar";

/**
 * Mobile nav strip — the console's AppSidebar is `hidden` below `md` (see
 * components/jeeves/app-sidebar.tsx), which left small screens with no way
 * to reach any route but the one currently loaded. This renders the same
 * nav items (grouped in the same Oversee/Operate/Govern/Administration order
 * as the sidebar) as a horizontally scrollable strip of pill links directly
 * under the top bar, `md:hidden` so it disappears once the sidebar takes
 * over.
 *
 * Active-item logic mirrors AppSidebar exactly (isNavItemActive: exact match
 * for Inbox, prefix match for everything else) so the two never disagree
 * about which route is "current."
 */
const FLAT_ITEMS: NavItem[] = [...NAV_SECTIONS.flatMap((section) => section.items), ADMIN_NAV_ITEM];

export function AppMobileNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="flex gap-1.5 overflow-x-auto border-b bg-card px-3 py-2 md:hidden scroll-thin"
    >
      {FLAT_ITEMS.map((item) => {
        const active = isNavItemActive(item, pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs whitespace-nowrap transition-colors duration-(--motion-base) ease-(--motion-ease) ${
              active
                ? "bg-accent font-medium text-accent-foreground shadow-[inset_0_0_0_1px_var(--border)]"
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
