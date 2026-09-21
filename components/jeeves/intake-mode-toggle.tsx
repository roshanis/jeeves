"use client";

/**
 * Mode toggle for /initiatives/new (ui-spec §4 M2 Breadth): "Structured form"
 * vs "Chat with intake assistant". Uses the existing `@/components/ui/tabs`
 * primitive (base-ui) so each mode is reachable by accessible name via
 * `getByRole("tab", {name: ...})` in tests.
 */
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IntakeForm } from "./intake-form";
import { IntakeChat } from "./intake-chat";
import type { IntakePayload } from "@/lib/intake/types";
import { EMPTY_INTAKE_PAYLOAD } from "@/lib/intake/defaults";

export function IntakeModeToggle({ initialPayload, initiativeId, initialVersion, initialSlug }: {
  initialPayload?: IntakePayload;
  initiativeId?: string;
  initialVersion?: number;
  initialSlug?: string;
}) {
  const [mode, setMode] = React.useState("structured");
  const [draft, setDraft] = React.useState({ payload: initialPayload ?? EMPTY_INTAKE_PAYLOAD, revision: 0 });
  // Updated synchronously by every editor action, even before React rerenders.
  const revision = React.useRef(0);

  function updatePayload(next: IntakePayload) {
    revision.current += 1;
    setDraft({ payload: next, revision: revision.current });
  }

  function applyChatPayload(next: IntakePayload, expectedRevision: number): boolean {
    if (revision.current !== expectedRevision) return false;
    updatePayload(next);
    return true;
  }
  return (
    <Tabs value={mode} onValueChange={setMode} data-slot="intake-mode-toggle">
      <TabsList>
        <TabsTrigger value="structured">Structured form</TabsTrigger>
        <TabsTrigger value="chat">Chat with intake assistant</TabsTrigger>
      </TabsList>
      <TabsContent value="structured" keepMounted>
        <IntakeForm initialPayload={draft.payload} onPayloadChange={updatePayload} initiativeId={initiativeId} initialVersion={initialVersion} initialSlug={initialSlug} />
      </TabsContent>
      <TabsContent value="chat" keepMounted>
        <IntakeChat payload={draft.payload} payloadRevision={draft.revision} onPayloadChange={applyChatPayload} onReview={() => setMode("structured")} />
      </TabsContent>
    </Tabs>
  );
}
