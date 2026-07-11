"use client";

/**
 * LiveSessionProvider — client-side live-demo session state (ui-spec §8.3).
 *
 * Holds `{token, workspaceId, expiresAt, personaKey, personaLabel, role}`
 * in a subscribable module store mirrored to sessionStorage, so the session
 * survives client-side navigation (and full reloads within the tab) but not
 * a browser restart. The token is sent as `Authorization: Bearer` by
 * lib/client/api.ts helpers — no cookie is set.
 *
 * Rehydration is done through `useSyncExternalStore` (server snapshot:
 * null), keeping SSR markup independent of sessionStorage and avoiding
 * setState-in-effect churn.
 *
 * `login()` also flips the existing demo role switcher (`useRole()`) to the
 * roleKey matching the persona's ActorRole, so role-based rendering
 * (RoleGate/HideForAdmin/saved views) stays consistent with what the API
 * will actually authorize. NOTE (documented judgment call): after a full
 * page reload the rehydrated session does NOT re-force the role switcher —
 * the switcher returns to its default while live-action gating continues to
 * key off the session's own role, which is the source of truth the API
 * enforces.
 *
 * `logout()` returns the app to read-only mode; it intentionally does NOT
 * clear the live-initiative registry (lib/client/live-registry.ts) — see
 * that module's header.
 *
 * Must be mounted INSIDE RoleProvider (it calls useRole()).
 */
import * as React from "react";
import { postSession } from "./api";
import { findPersona, roleKeyForActorRole, type LivePersona } from "./personas";
import { useRole } from "@/components/jeeves/role-context";

export interface LiveSession {
  token: string;
  workspaceId: string;
  expiresAt: number;
  personaKey: string;
  personaLabel: string;
  role: LivePersona["role"];
}

export interface LiveSessionContextValue {
  session: LiveSession | null;
  login: (passcode: string, personaKey: string) => Promise<LiveSession>;
  logout: () => void;
}

/* -------------------------------------------------------------------------
 * Module-level session store (subscribable, sessionStorage-backed)
 * ---------------------------------------------------------------------- */

const STORAGE_KEY = "jeeves_live_session";

let cachedSession: LiveSession | null | undefined; // undefined = not read yet
const listeners = new Set<() => void>();

function loadStoredSession(): LiveSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveSession;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed?.expiresAt !== "number" ||
      typeof parsed?.personaKey !== "string"
    ) {
      return null;
    }
    if (parsed.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getSessionSnapshot(): LiveSession | null {
  if (cachedSession === undefined) {
    cachedSession = loadStoredSession();
  }
  return cachedSession;
}

function getSessionServerSnapshot(): LiveSession | null {
  return null;
}

function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStoredSession(next: LiveSession | null): void {
  cachedSession = next;
  if (typeof window !== "undefined") {
    try {
      if (next) {
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } else {
        window.sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable — the session still works for this page's lifetime.
    }
  }
  for (const listener of listeners) listener();
}

/** Test-only: drop the module cache (and stored value) between tests. */
export function resetLiveSessionForTests(): void {
  cachedSession = undefined;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  for (const listener of listeners) listener();
}

/* -------------------------------------------------------------------------
 * Provider + hooks
 * ---------------------------------------------------------------------- */

const LiveSessionContext = React.createContext<LiveSessionContextValue | null>(null);

export function LiveSessionProvider({ children }: { children: React.ReactNode }) {
  const session = React.useSyncExternalStore(
    subscribeSession,
    getSessionSnapshot,
    getSessionServerSnapshot,
  );
  const { setRoleKey, setPersonaKey } = useRole();

  const login = React.useCallback(
    async (passcode: string, personaKey: string): Promise<LiveSession> => {
      const persona = findPersona(personaKey);
      if (!persona) {
        throw new Error(`unknown persona: ${personaKey}`);
      }
      const result = await postSession(passcode, personaKey);
      const next: LiveSession = {
        token: result.token,
        workspaceId: result.workspaceId,
        expiresAt: result.expiresAt,
        personaKey,
        personaLabel: persona.label,
        role: persona.role,
      };
      setStoredSession(next);
      // Select the exact persona (drives roleKey + reviewerDomain together)
      // so e.g. logging in as sofia-grant scopes the Inbox to Responsible AI.
      setPersonaKey(personaKey);
      // Kept for defense-in-depth / documentation of intent: setPersonaKey
      // above already derives the matching roleKey via roleKeyForActorRole,
      // so this is redundant but harmless (same roleKey, no extra render).
      setRoleKey(roleKeyForActorRole(persona.role));
      return next;
    },
    [setRoleKey, setPersonaKey],
  );

  const logout = React.useCallback(() => {
    setStoredSession(null);
  }, []);

  const value = React.useMemo(() => ({ session, login, logout }), [session, login, logout]);

  return <LiveSessionContext.Provider value={value}>{children}</LiveSessionContext.Provider>;
}

/** Throwing accessor for components that require the provider. */
export function useLiveSession(): LiveSessionContextValue {
  const ctx = React.useContext(LiveSessionContext);
  if (!ctx) {
    throw new Error("useLiveSession() must be used within a LiveSessionProvider");
  }
  return ctx;
}

/**
 * Non-throwing accessor for components (e.g. role-gate.tsx) that must keep
 * working when rendered without a LiveSessionProvider — existing tests and
 * any embedding context get the read-only behavior (`null` session).
 */
export function useLiveSessionOptional(): LiveSessionContextValue | null {
  return React.useContext(LiveSessionContext);
}
