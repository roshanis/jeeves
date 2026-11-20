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
//    renders visibly but disabled, with a Start demo tooltip.
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
import { useDeploymentMode } from "@/lib/client/deployment-mode-context";
import type { DeploymentMode } from "@/lib/config/deployment-mode";
import { signInPrompt } from "@/lib/client/mode-copy";
import type { LivePersona } from "@/lib/client/personas";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const DEMO_SESSION_TOOLTIP = "Start the demo to try this action";

/** The same prompt for the mode the page runs in. */
export function sessionTooltip(mode: DeploymentMode): string {
  return signInPrompt(mode, mode === "demo" ? "try this action" : "use this action");
}

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
  /** Only enable when the live session's ActorRole equals this role (or one of these roles). */
  requiresRole?: LivePersona["role"] | LivePersona["role"][];
  /** Why the action is unavailable to a signed-in persona (shown instead of the "start the demo" prompt). */
  disabledReason?: string;
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
  disabledReason,
  pending = false,
  pendingLabel,
  "data-slot": dataSlot,
}: GatedActionProps) {
  const live = useLiveSessionOptional();
  const session = live?.session ?? null;
  const mode = useDeploymentMode();
  const reasonId = React.useId();

  // A public (real request) session satisfies no live action.
  const allowedRoles = requiresRole === undefined ? [] : Array.isArray(requiresRole) ? requiresRole : [requiresRole];
  const roleSatisfied = session?.role !== "public" && (allowedRoles.length === 0 || (session !== null && allowedRoles.includes(session.role)));
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
    session?.role === "public"
      ? "Not available for a real request"
      : session && allowedRoles.length > 0 && !roleSatisfied
      ? `Requires the ${allowedRoles.join(" or ")} role${mode === "production" ? "" : " — choose a persona in the header"}`
      : session && disabledReason
      ? disabledReason
      : sessionTooltip(mode);

  return (
    <DisabledAction
      label={label}
      className={className}
      variant={variant}
      dataSlot={dataSlot}
      reason={tooltip}
      reasonId={reasonId}
    />
  );
}

/**
 * aria-disabled (not disabled) keeps the button focusable and named. The reason is linked with
 * aria-describedby for screen readers; sighted hover/focus users get the tooltip, and a tap or
 * click opens the same tooltip (controlled) so touch users see it too, without layout shift.
 * A tap, click or key press pins the reason: it stays until a press elsewhere, Escape, focus
 * leaving the action or another tooltip opening; hover without a press behaves as before. The
 * press also focuses the action, because Safari does not focus a clicked button and the reason
 * would then stay when Tab moves on.
 */
function DisabledAction({ label, className, variant, dataSlot, reason, reasonId }: {
  label: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  dataSlot?: string;
  reason: string;
  reasonId: string;
}) {
  const [open, setOpen] = React.useState(false);
  const pinned = React.useRef(false);
  return (
    <span className={cn("inline-flex", className)}>
      <Tooltip
        open={open}
        onOpenChange={(next, details) => {
          // A reason that was asked for stays when the mouse leaves. Every other close dismisses it.
          if (!next && pinned.current && details.reason === "trigger-hover") {
            details.cancel();
            return;
          }
          if (!next) pinned.current = false;
          setOpen(next);
        }}
      >
        <TooltipTrigger
          closeOnClick={false}
          render={
            <Button
              type="button"
              aria-disabled="true"
              aria-describedby={reasonId}
              variant={variant}
              className="w-full cursor-not-allowed opacity-50"
              data-slot={dataSlot ?? "button"}
              onClick={(event) => {
                pinned.current = true;
                event.currentTarget.focus({ preventScroll: true });
                setOpen(true);
              }}
            >
              {label}
            </Button>
          }
        />
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      <span id={reasonId} className="sr-only">{reason}</span>
    </span>
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
