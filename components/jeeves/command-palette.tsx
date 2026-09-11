"use client";

// Command palette (⌘K / Ctrl+K).
//
// Replaces a search <input> and a ⌘K <kbd> badge that did nothing at all:
// pressing the shortcut left focus on <body> and opened nothing, and typing
// a query and hitting Enter did nothing. It advertised a capability the app
// did not have, which is worse than having no search box.
//
// SCOPE IS DELIBERATELY NARROW — initiatives and console routes, nothing
// else. Both are guaranteed to return results (12 seeded initiatives, 9
// routes) from data the console layout already holds, so no category can
// ship empty. Controls, reviews and audit queries were considered and left
// out: each would need its own payload pushed into every console route to
// serve navigation that is rarer than these two, and a palette that
// sometimes returns nothing for a category it advertises would recreate the
// original sin in a new place.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { NAV_ITEMS } from "./app-sidebar";
import { cn } from "@/lib/utils";

export interface PaletteInitiative {
  slug: string;
  title: string;
}

export interface PaletteItem {
  key: string;
  label: string;
  hint: string;
  group: "Initiatives" | "Go to";
  href: string;
}

/**
 * Ranked substring match. A prefix hit on the label outranks a hit anywhere
 * else, so typing "prior" puts "Prior-Auth Clinical Summarizer" above an
 * initiative that merely mentions it. Returns null for "no match".
 */
export function scorePaletteItem(item: PaletteItem, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  if (label.startsWith(q)) return 3;
  if (label.includes(q)) return 2;
  if (hint.includes(q)) return 1;
  return null;
}

export function buildPaletteItems(initiatives: PaletteInitiative[]): PaletteItem[] {
  return [
    ...initiatives.map((i) => ({
      key: `initiative:${i.slug}`,
      label: i.title,
      hint: i.slug,
      group: "Initiatives" as const,
      href: `/initiatives/${i.slug}`,
    })),
    ...NAV_ITEMS.map((n) => ({
      key: `route:${n.href}`,
      label: n.label,
      hint: n.href,
      group: "Go to" as const,
      href: n.href,
    })),
  ];
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  return items
    .map((item) => ({ item, score: scorePaletteItem(item, query) }))
    .filter((r): r is { item: PaletteItem; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);
}

/**
 * The shortcut hint, resolved after mount. The correct key differs by
 * platform (⌘ on Apple, Ctrl elsewhere); the old badge hardcoded ⌘K, which
 * was already wrong for every Windows and Linux visitor. Deferring to an
 * effect avoids a hydration mismatch and means the hint is either accurate
 * or absent — never confidently wrong.
 */
const NO_OP_SUBSCRIBE = () => () => {};

export function useShortcutLabel(): string | null {
  // useSyncExternalStore rather than setState-in-an-effect: the platform
  // never changes, so there is nothing to synchronise — this is just a value
  // that is unknowable during SSR. The server snapshot is null (render no
  // hint), the client snapshot is the real key.
  return React.useSyncExternalStore(
    NO_OP_SUBSCRIBE,
    () => (/mac|iphone|ipad|ipod/i.test(navigator.userAgent ?? "") ? "⌘K" : "Ctrl K"),
    () => null,
  );
}

export function CommandPalette({ initiatives }: { initiatives: PaletteInitiative[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const shortcut = useShortcutLabel();
  const listId = React.useId();

  const items = React.useMemo(() => buildPaletteItems(initiatives), [initiatives]);
  const results = React.useMemo(() => filterPaletteItems(items, query), [items, query]);

  // Global shortcut. Accepting metaKey OR ctrlKey costs nothing and means an
  // external keyboard on an iPad works either way.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) {
            setQuery("");
            setActiveIndex(0);
          }
          return !prev;
        });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clamped at render rather than corrected in an effect: `activeIndex` can
  // fall out of range when typing shrinks the result set, and deriving the
  // safe value avoids storing a state that is briefly wrong (and the extra
  // render that fixing it would cost).
  const activeIndexSafe = activeIndex < results.length ? activeIndex : 0;
  const activeItem = results[activeIndexSafe] ?? null;

  const setOpenAndReset = React.useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
  }, []);

  const go = React.useCallback(
    (href: string) => {
      setOpenAndReset(false);
      router.push(href);
    },
    [router, setOpenAndReset],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((activeIndexSafe + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((activeIndexSafe - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeItem) go(activeItem.href);
    }
  }

  // Group headings are rendered by tracking where the group changes, so the
  // flat `results` array stays the single source of truth for both keyboard
  // indexing and painting — two parallel structures would drift.
  let lastGroup: string | null = null;

  return (
    <>
      {/* Desktop: looks like the search field it replaces, but is a button —
          the field opens a dialog, so a real input in the bar would be a
          second place to type that does nothing on its own. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="command-palette-trigger"
        className="relative hidden w-full max-w-sm items-center gap-2 rounded-md border bg-background py-1.5 pr-2 pl-8 text-left text-sm text-muted-foreground outline-none hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 xl:flex"
      >
        <Search className="pointer-events-none absolute left-2.5 size-4" aria-hidden />
        <span className="flex-1 truncate">Search initiatives and pages…</span>
        {shortcut ? (
          <kbd className="pointer-events-none hidden items-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline-flex">
            {shortcut}
          </kbd>
        ) : null}
      </button>

      {/* Below xl the field is hidden, so the palette needs its own reachable
          affordance — otherwise it would exist only for people with a
          keyboard. touch-min keeps it at the 44px touch target. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-slot="command-palette-trigger-compact"
        aria-label="Open search"
        className="touch-min inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground xl:hidden"
      >
        <Search className="size-4" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={setOpenAndReset}>
        <DialogContent
          showCloseButton={false}
          className="top-[12%] max-w-lg translate-y-0 gap-0 p-0 sm:max-w-lg"
          data-slot="command-palette"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search initiatives and console pages. Use the arrow keys to move
            through results and Enter to open one.
          </DialogDescription>

          <div className="flex items-center gap-2.5 border-b px-3.5">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {/* autoFocus: a command palette that does not focus its own
                input on open is broken. Focus is trapped inside the dialog
                and Escape returns it to the trigger. */}
            <input
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onInputKeyDown}
              placeholder="Search initiatives and pages…"
              aria-label="Search initiatives and pages"
              aria-controls={listId}
              aria-activedescendant={
                activeItem ? `${listId}-${activeItem.key}` : undefined
              }
              className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label="Search results"
            className="scroll-thin max-h-80 overflow-y-auto overscroll-contain p-1.5"
          >
            {results.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">
                No initiative or page matches “{query}”.
              </p>
            ) : (
              results.map((item, index) => {
                const showHeading = item.group !== lastGroup;
                lastGroup = item.group;
                const active = index === activeIndexSafe;
                return (
                  <React.Fragment key={item.key}>
                    {showHeading ? (
                      <p className="kicker px-2.5 pt-2.5 pb-1.5 text-muted-foreground">
                        {item.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      id={`${listId}-${item.key}`}
                      role="option"
                      aria-selected={active}
                      data-slot="command-palette-item"
                      onClick={() => go(item.href)}
                      onMouseMove={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm",
                        active ? "bg-accent text-accent-foreground" : "text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {item.hint}
                      </span>
                      {active ? (
                        <CornerDownLeft
                          className="size-3.5 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  </React.Fragment>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
