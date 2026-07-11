"use client";

/**
 * Demo mode indicator + passcode entry (ui-spec §8.3).
 *
 * Read-only state: a clickable "Read-only (public)" chip. Clicking opens a
 * passcode + persona dialog; a successful POST /api/session flips the app
 * into live mode via LiveSessionProvider (which also aligns the demo role
 * switcher with the chosen persona's role).
 *
 * Live state: "Live demo (session workspace)" chip + persona label + a
 * "Reset to read-only" affordance that drops the session client-side.
 *
 * Budget hint (judgment call, documented): there is no GET-budget route in
 * the API contract, so no live "42/50 actions" number can be shown without
 * fabricating data. The chip shows qualitative copy instead: daily token
 * budget + rate limits are enforced server-side and surfaced through 429
 * error toasts when hit.
 */
import * as React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLiveSession } from "@/lib/client/session-context";
import { isApiError, apiErrorToMessage } from "@/lib/client/api";
import { LIVE_PERSONAS, PERSONA_ROLE_LABEL, type LivePersona } from "@/lib/client/personas";

const ROLE_GROUPS: LivePersona["role"][] = [
  "requester",
  "reviewer",
  "approver",
  "admin",
  "program",
];

export function DemoModeChip() {
  const { session, login, logout } = useLiveSession();
  const [open, setOpen] = React.useState(false);
  const [passcode, setPasscode] = React.useState("");
  const [personaKey, setPersonaKey] = React.useState(LIVE_PERSONAS[0]!.personaKey);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const next = await login(passcode, personaKey);
      setOpen(false);
      setPasscode("");
      toast.success(`Live demo enabled — acting as ${next.personaLabel} (${next.role}).`);
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        setError("Incorrect passcode — try again.");
      } else if (isApiError(err)) {
        setError(apiErrorToMessage(err));
      } else {
        setError("Something went wrong — please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  if (session) {
    return (
      <span className="inline-flex items-center gap-1.5" data-slot="demo-mode-chip">
        <Badge variant="secondary" title="Session workspace active — daily demo token budget and rate limits are enforced server-side.">
          Live demo (session workspace)
        </Badge>
        <span className="text-xs text-muted-foreground">{session.personaLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          data-slot="live-reset"
          onClick={() => {
            logout();
            toast.info("Back to read-only mode.");
          }}
        >
          Reset to read-only
        </Button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        data-slot="demo-mode-chip"
        className="cursor-pointer"
        onClick={() => setOpen(true)}
      >
        <Badge variant="outline">Read-only (public)</Badge>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter live demo mode</DialogTitle>
            <DialogDescription>
              Enter the demo passcode and pick a persona. Mutations run in a
              session workspace with a daily token budget and rate limits
              enforced server-side.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Demo passcode</span>
              <input
                type="password"
                autoFocus
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                data-slot="passcode-input"
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Persona</span>
              <select
                value={personaKey}
                onChange={(e) => setPersonaKey(e.target.value)}
                data-slot="persona-select"
                className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {ROLE_GROUPS.map((role) => (
                  <optgroup key={role} label={PERSONA_ROLE_LABEL[role]}>
                    {LIVE_PERSONAS.filter((p) => p.role === role).map((p) => (
                      <option key={p.personaKey} value={p.personaKey}>
                        {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {error ? (
              <p className="text-sm text-destructive" data-slot="login-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={pending || passcode.length === 0} data-slot="live-login-submit">
              {pending ? "Checking…" : "Enter live mode"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
