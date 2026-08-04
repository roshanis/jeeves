"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * localStorage key for the persisted theme choice ("light" | "dark").
 * Absent key = follow the OS preference — the inline bootstrap script in
 * app/layout.tsx reads the same key before first paint so a persisted dark
 * choice never flashes light (and vice versa).
 */
export const THEME_STORAGE_KEY = "jeeves-theme";

/**
 * The theme is external state: the `dark` class on <html> (owned by the
 * pre-paint bootstrap script and this toggle, and toggle-able by devtools).
 * Modeled as an external store — a MutationObserver on the class attribute
 * is the subscription — so the component re-renders whenever the class
 * changes, without effect-driven setState.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

// Server render assumes light; useSyncExternalStore reconciles against the
// real class right after hydration (the bootstrap script has already set it,
// so a dark visitor gets one silent client-side correction, no flash).
function getServerSnapshot(): boolean {
  return false;
}

/** Light/dark toggle for the console top bar (tokens live in globals.css). */
export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const next = dark ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => {
        document.documentElement.classList.toggle("dark", !dark);
        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Storage unavailable (private mode etc.) — the toggle still works
          // for this page view; the choice just won't persist.
        }
      }}
      /* .touch-min (real 44px on touch), NOT .touch-target: this button sits
         at the left edge of the top bar's status cluster, and an overlay
         extending 6px past a 32px button reached across the gap and stole
         taps from the brand link beside it (measured — the brand's right
         probe resolved to this button). Growing for real keeps every hit
         area inside its own control. */
      className="touch-min inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors duration-(--motion-base) ease-(--motion-ease) hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
