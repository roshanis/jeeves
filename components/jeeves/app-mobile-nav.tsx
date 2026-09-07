"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, NAV_SECTIONS, ADMIN_NAV_ITEM, isNavItemActive, type NavItem } from "./app-sidebar";

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
/** Primary workflow links stay visible; supporting tools use a native disclosure. */
export function AppMobileNav() {
  const pathname = usePathname();

  function renderLinks(items: NavItem[]) {
    return items.map((item) => {
      const active = isNavItemActive(item, pathname);
      const Icon = item.icon;
      return (
        <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
          className={`flex h-11 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-sm whitespace-nowrap transition-colors duration-(--motion-base) ease-(--motion-ease) ${active ? "bg-accent text-accent-foreground font-medium shadow-[inset_0_0_0_1px_var(--border)]" : "text-muted-foreground hover:bg-muted"}`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden />{item.label}
        </Link>
      );
    });
  }
  const primaryItems = NAV_SECTIONS.flatMap((section) => section.items).filter((item) => item.href !== "/agents" && item.href !== "/promotions");
  const toolItems = [NAV_ITEMS.find((item) => item.href === "/agents")!, NAV_ITEMS.find((item) => item.href === "/promotions")!, ADMIN_NAV_ITEM];
  const selectedTool = toolItems.find((item) => isNavItemActive(item, pathname));
  return (
    <div className="pad-safe-x border-b bg-card md:hidden">
      <nav aria-label="Primary" className="scroll-thin scroll-x-pane flex gap-1.5 overflow-x-auto px-3 py-2">{renderLinks(primaryItems)}</nav>
      <details key={pathname} open={Boolean(selectedTool)} className="px-3 pb-2">
        <summary className="touch-min cursor-pointer px-3 py-1.5 text-xs text-muted-foreground">More tools{selectedTool ? ` · ${selectedTool.label}` : ""}</summary>
        <nav aria-label="Additional tools" className="flex flex-wrap gap-1.5 pt-1">{renderLinks(toolItems)}</nav>
      </details>
    </div>
  );
}
