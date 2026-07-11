"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Static "Read-only (public)" mode indicator (ui-spec §8.3). No working
 * passcode flow in this build — clicking would open a passcode dialog in a
 * live deployment; here it just documents the state via tooltip.
 */
export function DemoModeChip() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span tabIndex={0}>
            <Badge variant="outline" className="cursor-default">
              Read-only (public)
            </Badge>
          </span>
        }
      />
      <TooltipContent>Enter demo passcode to enable</TooltipContent>
    </Tooltip>
  );
}
