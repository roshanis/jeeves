"use client";

import { Button } from "@/components/ui/button";

// A full document reload, not a soft navigation: the console layout is shared
// across navigations, so only a fresh request re-checks whether the database
// is back.
export function DatabaseUnavailableReload() {
  return (
    <Button size="sm" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
