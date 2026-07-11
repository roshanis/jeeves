import Link from "next/link";
import { RoleSwitcher } from "./role-switcher";
import { DemoModeChip } from "./demo-mode-chip";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/reviews", label: "Reviews" },
  { href: "/controls", label: "Controls" },
  { href: "/audit", label: "Audit" },
  { href: "/admin", label: "Admin" },
];

// Exact required banner string (ui-spec §7/§8.1) — tests match on this text.
export const DEMO_BANNER_TEXT =
  "Fictional demo — synthetic data. Meridian Health is a fictional payer; not affiliated with any real organization.";

/**
 * Persistent global chrome (ui-spec §8): non-dismissible banner, role
 * switcher, demo-mode chip, and a flat nav visible to every role — no route
 * is role-scoped (§0/§11).
 */
export function Chrome() {
  return (
    <div className="border-b bg-amber-50 dark:bg-amber-950">
      <div className="mx-auto max-w-7xl px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:text-amber-200">
        {DEMO_BANNER_TEXT}
      </div>
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 border-t border-amber-200/60 px-4 py-3 dark:border-amber-900">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm font-semibold">
            Jeeves
          </Link>
          <nav className="flex items-center gap-3">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <DemoModeChip />
          <RoleSwitcher />
        </div>
      </header>
    </div>
  );
}
