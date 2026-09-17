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
 * Login and rehydration select the exact authenticated persona in the role
 * context, keeping visible identity, reviewer domain, and API authorization
 * aligned. Public preview switching is disabled while this session exists.
 *
 * `logout()` returns the app to read-only mode; it intentionally does NOT
 * clear the live-initiative registry (lib/client/live-registry.ts) — see
 * that module's header.
 *
 * Must be mounted INSIDE RoleProvider (it calls useRole()).
 */
import * as React from "react";
import { postSession } from "./api";
import { findPersona, type LivePersona } from "./personas";
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
  /**
   * Whether the passcode dialog is open. Lives here rather than inside
   * DemoModeChip so that anything which runs into the read-only gate can
   * offer the way past it — the intake form's read-only notice used to end
   * "(use the chip in the header)", sending the reader off to hunt for a
   * control instead of giving them one. The chip still OWNS the dialog; this
   * is only the open state, so there is one implementation rather than a
   * copy per caller.
   */
  unlockPromptOpen: boolean;
  setUnlockPromptOpen: (open: boolean) => void;
  /** Convenience for the common case: "let me in from here". */
  openUnlockPrompt: () => void;
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
    const persona = findPersona(parsed?.personaKey);
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed?.workspaceId !== "string" ||
      typeof parsed?.expiresAt !== "number" ||
      typeof parsed?.personaKey !== "string" ||
      !persona ||
      parsed.personaLabel !== persona.label ||
      parsed.role !== persona.role
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
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
  const { setPersonaKey } = useRole();

  React.useEffect(() => {
    if (!session) return;
    setPersonaKey(session.personaKey);
    const remainingMs = session.expiresAt - Date.now();
    if (remainingMs <= 0) {
      setStoredSession(null);
      return;
    }
    const timer = window.setTimeout(() => setStoredSession(null), remainingMs);
    return () => window.clearTimeout(timer);
  }, [session, setPersonaKey]);

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
      setPersonaKey(personaKey);
      return next;
    },
    [setPersonaKey],
  );

  const logout = React.useCallback(() => {
    setStoredSession(null);
  }, []);

  const [unlockPromptOpen, setUnlockPromptOpen] = React.useState(false);
  const openUnlockPrompt = React.useCallback(() => setUnlockPromptOpen(true), []);

  const value = React.useMemo(
    () => ({ session, login, logout, unlockPromptOpen, setUnlockPromptOpen, openUnlockPrompt }),
    [session, login, logout, unlockPromptOpen, openUnlockPrompt],
  );

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
