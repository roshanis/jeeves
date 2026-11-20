"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent } from "@/components/ui/tabs";

const TAB_IDS = ["overview", "intake", "evidence", "reviews", "decisions", "controls", "evals", "deployments", "audit"];

function validTab(value: string | null | undefined): string {
  if (value === "operate") return "evals";
  return value && TAB_IDS.includes(value) ? value : "overview";
}

/** The URL owns tab selection, including copied links and Back/Forward. */
export function InitiativeTabs({ initialTab, children }: { initialTab?: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = validTab(params.get("tab") ?? initialTab);
  // Tabs opened so far on this page view, for KeptTabsContent below.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set([value]));
  if (!visited.has(value)) setVisited(new Set([...visited, value]));
  return (
    <VisitedTabsContext.Provider value={visited}>
      <Tabs
        value={value}
        onValueChange={(next) => {
          const query = new URLSearchParams(params.toString());
          query.set("tab", validTab(String(next)));
          router.push(`${pathname}?${query.toString()}`, { scroll: false });
        }}
      >
        {children}
      </Tabs>
    </VisitedTabsContext.Provider>
  );
}

const VisitedTabsContext = createContext<ReadonlySet<string> | null>(null);

/**
 * A panel for a tab that holds unsaved work. Base UI unmounts a hidden panel,
 * which throws that work away on a glance at another tab; this one mounts on
 * its first visit and then stays mounted (hidden). It is NOT mounted before
 * that visit, so a page view that never opens the tab does not run its effects.
 */
export function KeptTabsContent({ value, children }: { value: string; children: ReactNode }) {
  const visited = useContext(VisitedTabsContext);
  return (
    <TabsContent value={value} keepMounted>
      {visited?.has(value) ? children : null}
    </TabsContent>
  );
}
