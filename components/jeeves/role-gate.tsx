"use client";

// RoleGate — two conceptually distinct, structurally separate mechanisms
// (ui-spec §0/§6/§7/§9/§11 call this out explicitly; do not conflate):
//
// 1. `HideForAdmin` — architectural separation of duties. Admin never holds
//    approval authority, so approve/sign/return-style buttons must not
//    render AT ALL for Admin, anywhere in the app (plan §2 step 8). This is
//    not a permission check on a button that exists; the DOM node itself is
//    absent when the active role is Admin.
//
// 2. `DisableWithTooltip` — authentication-state gating, orthogonal to role.
//    Without a live demo session, every mutation-looking control (Sign,
//    Return, Submit intake, Run monitor, Edit threshold, Pause/Resume)
//    renders visibly but disabled, with the tooltip text "Enter demo
//    passcode to enable" (exact string; tests match on it).
//
//    LIVE MODE (additive): a call site may pass `onAction` (and optionally
//    `requiresRole`). When a live session exists (LiveSessionProvider) and
//    its role satisfies `requiresRole`, the same button renders ENABLED and
//    wired to `onAction`. With no session — or when rendered outside a
//    LiveSessionProvider, as existing tests do — behavior is byte-for-byte
//    the original disabled-with-tooltip rendering.
//
// Sign/Return-style call sites compose both via GatedActionButton: nothing
// for Admin, disabled-with-tooltip (or live-enabled) for everyone else.
import * as React from "react";
import { useRole } from "./role-context";
import { useLiveSessionOptional } from "@/lib/client/session-context";
import type { LivePersona } from "@/lib/client/personas";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const DEMO_PASSCODE_TOOLTIP = "Enter demo passcode to enable";

/**
 * Mechanism 1: hides children entirely when the active role is Admin.
 * Use for approve/sign/return-style controls (separation of duties).
 */
export function HideForAdmin({ children }: { children: React.ReactNode }) {
  const { roleKey } = useRole();
  if (roleKey === "admin") {
    return null;
  }
  return <>{children}</>;
}

export interface GatedActionProps {
  label: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  /**
   * Live-mode wiring: invoked on click when a live session exists (and
   * `requiresRole` matches). Omitted = always disabled (original behavior).
   */
  onAction?: () => void | Promise<void>;
  /** Only enable when the live session's ActorRole equals this role. */
  requiresRole?: LivePersona["role"];
  /** Externally-managed in-flight state; disables the enabled button. */
  pending?: boolean;
  /** Label swap while pending (defaults to `label`). */
  pendingLabel?: string;
  "data-slot"?: string;
}

/**
 * Mechanism 2: auth-state gating. Disabled-with-tooltip by default; enabled
 * and wired to `onAction` when a live session with a satisfying role exists.
 */
export function DisableWithTooltip({
  label,
  className,
  variant,
  onAction,
  requiresRole,
  pending = false,
  pendingLabel,
  "data-slot": dataSlot,
}: GatedActionProps) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;

  const roleSatisfied = !requiresRole || session?.role === requiresRole;
  const enabled = Boolean(session && onAction && roleSatisfied);

  if (enabled) {
    return (
      <Button
        type="button"
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => void onAction?.()}
        data-slot={dataSlot ?? "button"}
        data-live-action="true"
      >
        {pending ? (pendingLabel ?? label) : label}
      </Button>
    );
  }

  const tooltip =
    session && requiresRole && !roleSatisfied
      ? `Requires the ${requiresRole} role — switch persona via the demo mode chip`
      : DEMO_PASSCODE_TOOLTIP;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn("inline-flex", className)} tabIndex={0}>
            <Button
              type="button"
              disabled
              variant={variant}
              className="pointer-events-none w-full"
              data-slot={dataSlot ?? "button"}
            >
              {label}
            </Button>
          </span>
        }
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Combined call-site helper for approve/sign/return-style actions: renders
 * nothing when role is Admin (mechanism 1), else the auth-gated button
 * (mechanism 2 — disabled without a live session, live-wired with one).
 */
export function GatedActionButton(props: GatedActionProps) {
  return (
    <HideForAdmin>
      <DisableWithTooltip {...props} />
    </HideForAdmin>
  );
}
