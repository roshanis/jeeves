"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLiveSession } from "@/lib/client/session-context";
import type { ComponentProps } from "react";
import { READ_ONLY_PREVIEW_MESSAGE } from "@/lib/data/provider-mode";

/** One click from the public site to an editable requester intake. */
export function TryDemoButton({ className, size = "lg", variant }: Pick<ComponentProps<typeof Button>, "className" | "size" | "variant">) {
  const { login, liveModeAvailable = true, pending, startError } = useLiveSession();
  const router = useRouter();
  return (
    <div className="inline-flex flex-col items-start gap-2">
      <Button className={className} size={size} variant={variant} disabled={!liveModeAvailable || pending} onClick={async () => {
        try {
          await login("priya-raman");
          router.push("/initiatives/new");
        } catch { /* The provider keeps a visible, retryable error. */ }
      }}>
        {pending ? "Starting…" : "Try the demo"}
      </Button>
      {!liveModeAvailable ? <p className="max-w-sm text-sm">{READ_ONLY_PREVIEW_MESSAGE}</p> : null}
      {startError ? <p role="alert" className="max-w-sm text-sm">{startError}</p> : null}
    </div>
  );
}
