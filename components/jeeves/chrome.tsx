"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardCheck,
  ShieldCheck,
  ScrollText,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { RoleSwitcher } from "./role-switcher";
import { DemoModeChip } from "./demo-mode-chip";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/reviews", label: "Reviews", icon: ClipboardCheck },
  { href: "/controls", label: "Controls", icon: ShieldCheck },
  { href: "/audit", label: "Audit", icon: ScrollText },
  { href: "/admin", label: "Admin", icon: Settings2 },
];

// Exact required banner string (ui-spec §7/§8.1) — tests match on this text.
export const DEMO_BANNER_TEXT =
  "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.";

/**
 * Persistent global chrome (ui-spec §8): a non-dismissible demo-disclaimer
 * strip above a premium dark navigation header. The nav is flat and visible
 * to every role — no route is role-scoped (§0/§11); role only changes which
 * ACTIONS render inside a page.
 */
export function Chrome() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-40">
      <div className="bg-amber-100 dark:bg-amber-950/80">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:text-amber-200">
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{DEMO_BANNER_TEXT}</span>
        </div>
      </div>

      <header className="border-b border-white/10 bg-sidebar text-sidebar-foreground shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-5">
            <Link href="/" className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <span className="text-base font-semibold tracking-tight">
                Jeeves
              </span>
            </Link>
            <nav className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-white/15 font-medium text-white"
                        : "text-sidebar-foreground/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <DemoModeChip />
            <RoleSwitcher />
          </div>
        </div>
      </header>
    </div>
  );
}
