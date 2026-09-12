// Human-readable labels for domain values — pure data, no JSX.
//
// This map used to live in components/jeeves/domain-labels.tsx alongside
// <ReviewStatusBadge>. That file is server-safe, but it exports a React
// component, so anything in lib/ importing the map would have pulled JSX
// into the service layer — and lib/ importing from components/ is the wrong
// direction regardless. lib/services/notification-service.ts needs these
// labels to render a review request at enqueue time, hence the split.
//
// domain-labels.tsx re-exports DOMAIN_LABEL, so its existing importers are
// unaffected.
import type { Domain } from "./types";

export const DOMAIN_LABEL: Record<Domain, string> = {
  legal: "Legal",
  procurement: "Procurement",
  "tech-architecture": "Tech Architecture",
  "responsible-ai": "Responsible AI",
  security: "Security",
  "privacy-hipaa": "Privacy/HIPAA",
  "clinical-safety": "Clinical Safety",
  "data-governance": "Data Governance",
};
