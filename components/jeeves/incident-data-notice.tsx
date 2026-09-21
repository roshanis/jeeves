export function IncidentDataNotice({ reason }: { reason: "preview" | "load_failed" }) {
  return (
    <p role="status" className="px-4 py-3 text-sm text-muted-foreground">
      {reason === "preview"
        ? "Incident records are not included in this preview."
        : "Incident records could not be loaded. Refresh to try again."}
    </p>
  );
}
