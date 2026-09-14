// Console loading state.
//
// Every console page is an async server component that awaits the data
// provider (and, against Neon, a network round trip). Without a loading.tsx
// Next has no fallback to show while that resolves, so a navigation simply
// does nothing visible until the whole page is ready — on a slow connection
// that reads as a dead click.
//
// A skeleton in the shape of the page that is coming, not a spinner: the
// chrome (sidebar, top bar) is already on screen from the layout, so what is
// missing is a heading and a panel, and showing their outlines keeps the
// layout from jumping when the real content lands.
export default function ConsoleLoading() {
  return (
    <div className="flex flex-col gap-6" data-slot="console-loading" aria-busy="true">
      <span className="sr-only" role="status">
        Loading…
      </span>

      <div className="flex flex-col gap-2">
        <div className="h-7 w-64 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
      </div>

      <div className="panel overflow-hidden">
        <div className="border-b border-border px-4 py-2.5">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-4 w-16 shrink-0 animate-pulse rounded bg-muted" />
              <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
              <div className="h-4 w-20 shrink-0 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
