"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DOMAIN_LABEL } from "@/components/jeeves/domain-labels";
import {
  ReviewWorkbench,
  type ReviewQueueRow,
  type ReviewSelection,
} from "@/components/jeeves/review-workbench";
import type { Domain } from "@/lib/domain/types";

/** Keep the workbench mounted as URL selection changes so human edits remain
 * scoped to their session/case/domain/cycle in its draft cache. */
export function ReviewWorkbenchRoute({ rows }: { rows: ReviewQueueRow[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const slug = params.get("initiative");
  const domain = params.get("domain");
  const selection: ReviewSelection | null = slug && domain && Object.hasOwn(DOMAIN_LABEL, domain)
    ? { slug, domain: domain as Domain }
    : null;

  function select(next: ReviewSelection | null) {
    const query = new URLSearchParams(params.toString());
    if (next) {
      query.set("initiative", next.slug);
      query.set("domain", next.domain);
    } else {
      query.delete("initiative");
      query.delete("domain");
    }
    router.push(`/reviews${query.size ? `?${query.toString()}` : ""}`, { scroll: false });
  }

  return <ReviewWorkbench rows={rows} selection={selection} onSelectionChange={select} />;
}
