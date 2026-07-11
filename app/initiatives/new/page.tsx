// /initiatives/new — structured intake flow (ui-spec §4, intake-spec §1).
// The form itself is a client component (live tier preview + completeness
// meter recompute on every change); this page provides the static shell.
import { IntakeForm } from "@/components/jeeves/intake-form";

export const metadata = {
  title: "New Initiative — Jeeves",
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
      <IntakeForm />
    </div>
  );
}
