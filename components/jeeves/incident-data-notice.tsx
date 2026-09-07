export function IncidentDataNotice({ reason }: { reason: "preview" | "load_failed" }) {
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      Incident data unavailable. {reason === "preview"
        ? "This preview has no connected incident store."
        : "The incident records could not be loaded. Refresh to try again; an empty list has not been verified."}
    </p>
  );
}
