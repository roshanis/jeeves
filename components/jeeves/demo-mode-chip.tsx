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
import { Lock } from "lucide-react";
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

  // Both states read as a state LED (solid/pulsing dot) + a mono system
  // label — a status readout rather than a floating pill.
  if (session) {
    return (
      <span className="inline-flex items-center gap-2" data-slot="demo-mode-chip">
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2 py-1"
          title="Session workspace active — daily demo token budget and rate limits are enforced server-side."
        >
          <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          {/* Phones show just "Live" — the qualifier is ~120px of a 375px
              viewport, and live mode is already unmistakable from the pulsing
              LED and primary tint. `sr-only` (not `hidden`) on the remainder
              keeps the full phrase in the accessibility tree and in
              textContent at every width, so screen-reader users and the
              tests that assert on "Live demo (session workspace)" both still
              see the whole label. */}
          <span className="label-mono whitespace-nowrap text-primary">
            {/* Two spans rather than one split label, deliberately. The
                phone-sized abbreviation is aria-hidden and the full phrase is
                sr-only until `sm`, so the accessibility tree reads exactly
                one complete label at every width — and the full phrase stays
                a single text node, which is what queries that match on an
                element's own text (Testing Library's getByText, and the e2e
                assertion on this chip) actually look for. */}
            <span className="sm:hidden" aria-hidden>
              Live
            </span>
            <span className="sr-only sm:not-sr-only sm:inline">Live demo (session workspace)</span>
          </span>
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {session.personaLabel}
        </span>
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
          {/* Same two-span pattern as the live label above. A single split
              label ("Reset" + a nested " to read-only") does NOT work here:
              accessible-name computation trims each node before joining, so
              the leading space is dropped and the button ends up named
              "Resetto read-only". Two complete strings, with the phone-sized
              one aria-hidden, keep the name exactly "Reset to read-only". */}
          <span className="sm:hidden" aria-hidden>
            Reset
          </span>
          <span className="sr-only sm:not-sr-only sm:inline">Reset to read-only</span>
        </Button>
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        data-slot="demo-mode-chip"
        className="touch-target inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 transition-colors duration-(--motion-base) ease-(--motion-ease) hover:bg-accent"
        onClick={() => setOpen(true)}
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
        {/* Screen-reader-only on phones, visible from `sm` up. The padlock
            and the grey LED already carry this state visually, and the ~110px
            of label was the difference between the status cluster fitting a
            375px bar and squeezing its neighbours. `sr-only` rather than
            `hidden` deliberately: the text stays in the accessibility tree at
            every width, so the icon-only state keeps its accessible name
            without resorting to an aria-label that would shadow the visible
            text on desktop. */}
        <span className="label-mono sr-only whitespace-nowrap text-muted-foreground sm:not-sr-only sm:inline">
          Read-only (public)
        </span>
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
