import Link from "next/link";
import {
  CONTROL_FRAMEWORK_MAPPINGS,
  FRAMEWORK_DISCLAIMER,
  type FrameworkPageMeta,
  type FrameworkRef,
} from "@/lib/marketing/framework-mappings";

interface RequirementGroup {
  ref: string;
  label: string;
  controls: {
    controlId: string;
    controlName: string;
    evidence: string;
  }[];
}

/** Groups CONTROL_FRAMEWORK_MAPPINGS by each distinct ref found in the
 *  page's refKey column (nistAiRmf or euAiAct) — a requirement can be
 *  evidenced by several controls, so each group becomes one row. */
function groupByRequirement(refKey: "nistAiRmf" | "euAiAct"): RequirementGroup[] {
  const groups = new Map<string, RequirementGroup>();

  for (const mapping of CONTROL_FRAMEWORK_MAPPINGS) {
    const refs: FrameworkRef[] = mapping[refKey];
    for (const ref of refs) {
      let group = groups.get(ref.ref);
      if (!group) {
        group = { ref: ref.ref, label: ref.label, controls: [] };
        groups.set(ref.ref, group);
      }
      group.controls.push({
        controlId: mapping.controlId,
        controlName: mapping.controlName,
        evidence: mapping.evidence,
      });
    }
  }

  return [...groups.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * Pure presentational server component: renders the control-framework
 * crosswalk for one FRAMEWORK_PAGES entry — one row per distinct
 * requirement (ref), each showing the controls in the demo catalog that
 * evidence it. Every page that renders this must show FRAMEWORK_DISCLAIMER
 * (rendered here, once, at the top) — see lib/marketing/framework-mappings.ts.
 */
export function FrameworkMappingTable({ page }: { page: FrameworkPageMeta }) {
  const groups = groupByRequirement(page.refKey);

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-md border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {FRAMEWORK_DISCLAIMER}
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-[36rem] flex-col gap-4">
          {groups.map((group) => (
            <div
              key={group.ref}
              data-slot="framework-requirement-row"
              className="rounded-lg border p-4"
            >
              <h3 className="text-sm font-semibold">
                <span className="font-mono">{group.ref}</span> — {group.label}
              </h3>

              <div className="mt-3 flex flex-col gap-3">
                {group.controls.map((control) => (
                  <div
                    key={control.controlId}
                    className="flex flex-col gap-1 border-t pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-start sm:gap-3"
                  >
                    <Link
                      href="/controls"
                      data-slot="framework-control-chip"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium hover:bg-muted"
                    >
                      <span className="font-mono">{control.controlId}</span>
                      <span>{control.controlName}</span>
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {control.evidence}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
