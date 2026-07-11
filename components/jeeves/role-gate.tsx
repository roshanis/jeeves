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
//    This read-only build has no working passcode flow, so every
//    mutation-looking control (Sign, Return, Submit intake, Run monitor,
//    Edit threshold, Pause/Resume) renders visibly but disabled, with the
//    tooltip text "Enter demo passcode to enable" (exact string; tests
//    match on it).
//
// Sign/Return-style call sites compose both via GatedActionButton: nothing
// for Admin, disabled-with-tooltip for everyone else. Admin-console actions
// (Run monitor / Edit threshold / Pause-Resume) are not approval actions,
// so they use DisableWithTooltip directly for every role.
import * as React from "react";
import { useRole } from "./role-context";
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

/**
 * Mechanism 2: renders a disabled button with the mandatory auth-gating
 * tooltip. Always disabled in this read-only build, regardless of role.
 */
export function DisableWithTooltip({
  label,
  className,
  variant,
}: {
  label: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
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
            >
              {label}
            </Button>
          </span>
        }
      />
      <TooltipContent>{DEMO_PASSCODE_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Combined call-site helper for approve/sign/return-style actions: renders
 * nothing when role is Admin (mechanism 1), else a disabled-with-tooltip
 * button (mechanism 2).
 */
export function GatedActionButton({
  label,
  className,
  variant,
}: {
  label: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
}) {
  return (
    <HideForAdmin>
      <DisableWithTooltip label={label} className={className} variant={variant} />
    </HideForAdmin>
  );
}
