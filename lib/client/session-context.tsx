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
 * aligned. The persona picker exchanges sessions to explore each role in the same workspace.
 *
 * `logout()` returns the app to read-only mode; it intentionally does NOT
 * clear the live-initiative registry (lib/client/live-registry.ts) — see
 * that module's header.
 *
 * The root layout owns one provider with runtime liveModeAvailable, preserving
 * pending entry across route groups. Previews neither read stored session data
 * nor offer login; the stored value is preserved.
 * Must be mounted INSIDE RoleProvider (it calls useRole()).
 */
import * as React from "react";
import { ApiError, apiErrorToMessage, isApiError, postPublicSession, postSession } from "./api";
import { findPersona, type LivePersona } from "./personas";
import { useRole } from "@/components/jeeves/role-context";
import { READ_ONLY_PREVIEW_MESSAGE } from "@/lib/data/provider-mode";

export interface LiveSession {
  token: string;
  workspaceId: string;
  expiresAt: number;
  personaKey: string;
  personaLabel: string;
  /**
   * `public` is a real session with almost no authority — an anonymous
   * visitor filling in the intake form. It is not a demo persona and never
   * appears in the persona picker.
   */
  role: LivePersona["role"] | "public";
}

/** Marks a session as a passcode-free public submitter's. */
export const PUBLIC_PERSONA_KEY = "public";

export interface LiveSessionContextValue {
  session: LiveSession | null;
  liveModeAvailable: boolean;
  login: (personaKey: string) => Promise<LiveSession>;
  /** Passcode-free session for a public visitor sending a REAL request to the
   *  operator — distinct from startDemo, which opens the sandbox playground. */
  startPublicSession: () => Promise<LiveSession>;
  logout: () => void;
  pending: boolean;
  startError: string | null;
  /** Start a requester session directly from an action's entry point. */
  startDemo: () => void;
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
    const shapeOk =
      typeof parsed?.token === "string" &&
      typeof parsed?.workspaceId === "string" &&
      typeof parsed?.expiresAt === "number" &&
      typeof parsed?.personaKey === "string";
    // A public session has no persona to validate against — checking it
    // against the directory (as every other session is checked) would throw
    // it away on the first reload, mid-form.
    const identityOk =
      parsed?.personaKey === PUBLIC_PERSONA_KEY
        ? parsed.role === "public"
        : (() => {
            const persona = findPersona(parsed?.personaKey);
            return (
              !!persona &&
              parsed.personaLabel === persona.label &&
              parsed.role === persona.role
            );
          })();
    if (!shapeOk || !identityOk) {
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

export function LiveSessionProvider({ children, liveModeAvailable = true }: {
  children: React.ReactNode;
  liveModeAvailable?: boolean;
}) {
  const session = React.useSyncExternalStore(
    subscribeSession,
    liveModeAvailable ? getSessionSnapshot : getSessionServerSnapshot,
    getSessionServerSnapshot,
  );
  const { setPersonaKey } = useRole();

  React.useEffect(() => {
    if (!session) return;
    // A public submitter is not a persona. Pushing their key into the role
    // context would hit findLivePersona's defensive fallback and quietly
    // present them as the Program Office — a stranger shown an identity with
    // authority they do not have.
    if (session.personaKey !== PUBLIC_PERSONA_KEY) {
      setPersonaKey(session.personaKey);
    }
    const remainingMs = session.expiresAt - Date.now();
    if (remainingMs <= 0) {
      setStoredSession(null);
      return;
    }
    const timer = window.setTimeout(() => setStoredSession(null), remainingMs);
    return () => window.clearTimeout(timer);
  }, [session, setPersonaKey]);

  const [pending, setPending] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);
  const entryRequest = React.useRef<Promise<LiveSession> | null>(null);
  const version = React.useRef(0);

  const login = React.useCallback((personaKey: string): Promise<LiveSession> => {
    if (!liveModeAvailable) {
      setStartError(READ_ONLY_PREVIEW_MESSAGE);
      return Promise.reject(new ApiError(403, READ_ONLY_PREVIEW_MESSAGE));
    }
    // All entry controls share one request, including rapid double clicks.
    if (entryRequest.current) return entryRequest.current;
    const persona = findPersona(personaKey);
    if (!persona) return Promise.reject(new Error("Unknown demo persona."));
    const requestVersion = ++version.current;
    setPending(true);
    setStartError(null);
    const request = (async () => {
      try {
        const current = getSessionSnapshot();
        const token = current && current.expiresAt > Date.now() ? current.token : undefined;
        const result = await postSession(personaKey, token);
        if (requestVersion !== version.current) throw new Error("Demo entry cancelled.");
        const next: LiveSession = {
          ...result, personaKey, personaLabel: persona.label, role: persona.role,
        };
        setStoredSession(next);
        setPersonaKey(personaKey);
        return next;
      } catch (err) {
        if (requestVersion === version.current) {
          if (isApiError(err) && err.status === 401) setStoredSession(null);
          setStartError(isApiError(err) ? apiErrorToMessage(err) : "Could not start the demo. Try again.");
        }
        throw err;
      } finally {
        if (requestVersion === version.current) {
          entryRequest.current = null;
          setPending(false);
        }
      }
    })();
    entryRequest.current = request;
    return request;
  }, [liveModeAvailable, setPersonaKey]);

  /**
   * Begin a public session for sending a REAL request to the operator — as
   * opposed to startDemo, which opens the sandbox playground. No persona: just
   * an identity to hang one submission and one isolated workspace on.
   *
   * Shares login()'s discipline rather than its own ad-hoc path: the same
   * read-only-preview refusal, the same single in-flight request (so a double
   * click cannot mint two sessions), and the same version fence — a response
   * that lands after Exit, or after the visitor switched to the playground,
   * must not resurrect a session they have already left.
   */
  const startPublicSession = React.useCallback((): Promise<LiveSession> => {
    if (!liveModeAvailable) {
      setStartError(READ_ONLY_PREVIEW_MESSAGE);
      return Promise.reject(new ApiError(403, READ_ONLY_PREVIEW_MESSAGE));
    }
    if (entryRequest.current) return entryRequest.current;
    const requestVersion = ++version.current;
    setPending(true);
    setStartError(null);
    const request = (async () => {
      try {
        const result = await postPublicSession();
        if (requestVersion !== version.current) throw new Error("Request start cancelled.");
        const next: LiveSession = {
          token: result.token,
          workspaceId: result.workspaceId,
          expiresAt: result.expiresAt,
          personaKey: PUBLIC_PERSONA_KEY,
          personaLabel: "Public visitor",
          role: "public",
        };
        setStoredSession(next);
        return next;
      } catch (err) {
        if (requestVersion === version.current) {
          setStartError(isApiError(err) ? apiErrorToMessage(err) : "Could not start a request. Try again.");
        }
        throw err;
      } finally {
        if (requestVersion === version.current) {
          entryRequest.current = null;
          setPending(false);
        }
      }
    })();
    entryRequest.current = request;
    return request;
  }, [liveModeAvailable]);

  const logout = React.useCallback(() => {
    version.current++;
    entryRequest.current = null;
    setPending(false);
    setStartError(null);
    setStoredSession(null);
  }, []);

  const startDemo = React.useCallback(() => {
    void login("priya-raman").catch(() => { /* startError is rendered by entry controls. */ });
  }, [login]);

  const value = React.useMemo(
    () => ({ session, liveModeAvailable, login, logout, pending, startError, startDemo, startPublicSession }),
    [session, liveModeAvailable, login, logout, pending, startError, startDemo, startPublicSession],
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
