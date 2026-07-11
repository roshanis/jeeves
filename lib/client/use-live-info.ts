"use client";

/**
 * Hook: reactive lookup of a slug's live ids (initiativeId/cycleId) from
 * the live registry. Hydration-safe — the server snapshot is the empty
 * registry, so SSR markup never depends on sessionStorage.
 */
import * as React from "react";
import {
  getRegistryServerSnapshot,
  getRegistrySnapshot,
  subscribeRegistry,
  type LiveInitiativeInfo,
} from "./live-registry";

export function useLiveInfo(slug: string | undefined): LiveInitiativeInfo | null {
  const registry = React.useSyncExternalStore(
    subscribeRegistry,
    getRegistrySnapshot,
    getRegistryServerSnapshot,
  );
  return slug ? (registry[slug] ?? null) : null;
}
