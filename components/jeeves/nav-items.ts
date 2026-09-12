// Console navigation data — the single source of truth for the sidebar, the
// mobile nav strip, the top bar's breadcrumb, the ⌘K palette, and the 404.
//
// This lives OUTSIDE app-sidebar.tsx because that module is "use client".
// Importing a plain value from a client module into a SERVER component does
// not give you the value — it gives you a client-reference proxy, so
// `NAV_SECTIONS.flatMap(...)` fails at prerender with
// "f.NAV_SECTIONS.flatMap is not a function". The build caught it on
// app/(console)/not-found.tsx; a jsdom test never would, because there is no
// server/client boundary in jsdom.
//
// Keeping the data in a boundary-free module means either side can import it.
// app-sidebar.tsx re-exports these names so existing importers are unaffected.
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

// Flat order is preserved verbatim (routes/labels unchanged) — nothing in
// this repo may depend on NAV_ITEMS ordering changing. NAV_SECTIONS below is
// a purely presentational grouping over the same items, used by the sidebar,
// the mobile nav strip and the 404 so they never disagree about section
// order (design pass 2026-08-01).
// `section` ("primary" | "tools") arrives from PR #7 — it splits the mobile
// nav strip into the routes an operator works in daily and the ones they
// visit occasionally. Preserved here verbatim when the data moved out of
// app-sidebar.tsx.
export const NAV_ITEMS = [
  { href: "/inbox", label: "Inbox", section: "primary", icon: Inbox, exact: true },
  { href: "/portfolio", label: "Portfolio", section: "primary", icon: LayoutList },
  { href: "/reviews", label: "Reviews", section: "primary", icon: ClipboardCheck },
  { href: "/agents", label: "Agents", section: "tools", icon: Bot },
  { href: "/monitoring", label: "Monitoring", section: "primary", icon: Activity },
  { href: "/controls", label: "Controls", section: "primary", icon: ShieldCheck },
  { href: "/audit", label: "Audit", section: "primary", icon: ScrollText },
  { href: "/promotions", label: "Promotions", section: "tools", icon: GitPullRequestArrow },
  { href: "/admin", label: "Administration", section: "tools", icon: Settings2 },
];

export type NavItem = (typeof NAV_ITEMS)[number];

/** Look up a single nav item by href. Exported because the sidebar pins
 *  /agents and /promotions into their own "More tools" group (PR #7). */
export function navItem(href: string): NavItem {
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
