import { getAppProvider, getCurrentWorkspaceId } from "@/app/_lib/data-provider";
import { AppTopBar } from "./app-topbar";

// Async server wrapper that loads the ⌘K palette's search index and hands it
// to the (client) top bar.
//
// This is a separate component rather than a fetch inside
// app/(console)/layout.tsx on purpose. Making the LAYOUT async turned the
// console shell into something @testing-library/react cannot render —
// "<ConsoleLayout> is an async Client Component" — which broke
// tests/ui/skip-link.test.tsx, whose whole job is asserting that <main>
// carries the skip link's target id. The shell is worth keeping
// synchronously renderable; only this slot needs to await anything, and the
// layout wraps it in <Suspense> so the rest of the chrome paints immediately
// and the index streams in.
//
// The index is workspace-scoped like every other read, so a live session's
// palette never surfaces the seeded workspace's initiatives or vice versa.
export async function ConsoleTopBar() {
  const viewerWorkspaceId = await getCurrentWorkspaceId();
  const initiatives = (
    await getAppProvider().listInitiatives({ viewerWorkspaceId })
  ).map((i) => ({ slug: i.slug, title: i.title }));

  return <AppTopBar initiatives={initiatives} />;
}
