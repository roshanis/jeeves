"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

const TAB_IDS = ["overview", "intake", "reviews", "decisions", "controls", "evals", "deployments", "audit"];

function validTab(value: string | null | undefined): string {
  if (value === "operate") return "evals";
  return value && TAB_IDS.includes(value) ? value : "overview";
}

/** The URL owns tab selection, including copied links and Back/Forward. */
export function InitiativeTabs({ initialTab, children }: { initialTab?: string; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <Tabs
      value={validTab(params.get("tab") ?? initialTab)}
      onValueChange={(value) => {
        const next = new URLSearchParams(params.toString());
        next.set("tab", validTab(String(value)));
        router.push(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    >
      {children}
    </Tabs>
  );
}
