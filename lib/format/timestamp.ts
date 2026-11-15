/** "YYYY-MM-DD HH:MM UTC" from an ISO instant. Fixed UTC (not the viewer's zone) so server and client render the same text. */
export function formatUtcTimestamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso.slice(0, 10);
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
