// Marketing loading state — see app/(console)/loading.tsx for the rationale.
// Lighter than the console's: these pages are prose, so the skeleton is a
// heading and a few lines rather than a table.
export default function MarketingLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-16"
      data-slot="marketing-loading"
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        Loading…
      </span>
      <div className="h-9 w-3/4 max-w-lg animate-pulse rounded-md bg-muted" />
      <div className="flex flex-col gap-2.5">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
