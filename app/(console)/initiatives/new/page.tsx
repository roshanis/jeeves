// /initiatives/new — structured + conversational intake flows (ui-spec §4,
// intake-spec §1). The mode toggle and both modes are client components
// (live tier preview + completeness meter recompute on every change / chat
// state); this page provides the static shell.
import { IntakeModeToggle } from "@/components/jeeves/intake-mode-toggle";
import type { Metadata } from "next";

export const metadata: Metadata = {
  // Was "New Initiative — Jeeves": the suffix is now the root layout's
  // title template, so repeating it here produced "... — Jeeves · Jeeves".
  title: "New initiative",
  description:
    "Start an AI initiative intake: what it does, what data it touches, and who it affects. Completeness and a live risk-tier preview update as you type.",
};

export default function NewInitiativePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Initiative</h1>
        <p className="text-sm text-muted-foreground">
          Structured intake — the six overlay questions drive deterministic
          triage (tier + required review domains) the moment you answer them.
        </p>
      </div>
      <IntakeModeToggle />
    </div>
  );
}
