"use client";

import * as React from "react";
import { useLiveSession } from "@/lib/client/session-context";
import { getIntakeDraft, isApiError, apiErrorToMessage, type IntakeDraftResult } from "@/lib/client/api";
import { IntakeModeToggle } from "./intake-mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function IntakeDraftEditor({ initiativeId }: { initiativeId: string }) {
  const { session, logout } = useLiveSession();
  const [loaded, setLoaded] = React.useState<{ token: string; initiativeId: string; draft: IntakeDraftResult } | null>(null);
  const [failure, setFailure] = React.useState<{ token: string; initiativeId: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!session) return;
    let active = true;
    const token = session.token;
    void getIntakeDraft(token, initiativeId).then((value) => {
      if (active) setLoaded({ token, initiativeId, draft: value });
    }).catch((cause: unknown) => {
      if (!active) return;
      const message = isApiError(cause) ? apiErrorToMessage(cause) : "Unable to load this draft.";
      setFailure({ token, initiativeId, message });
      if (isApiError(cause) && cause.status === 401) logout();
    });
    return () => { active = false; };
  }, [initiativeId, session, logout]);

  if (!session) return <Alert><AlertTitle>Live session required</AlertTitle><AlertDescription>Enter the demo passcode as the requester who owns this draft.</AlertDescription></Alert>;
  const error = failure?.token === session.token && failure.initiativeId === initiativeId ? failure.message : null;
  const draft = loaded?.token === session.token && loaded.initiativeId === initiativeId ? loaded.draft : null;
  if (error) return <Alert variant="destructive"><AlertTitle>Draft unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  if (!draft) return <p className="text-sm text-muted-foreground">Loading draft…</p>;
  return <IntakeModeToggle initialPayload={draft.payload} initiativeId={draft.initiativeId} initialVersion={draft.version} initialSlug={draft.slug} />;
}
