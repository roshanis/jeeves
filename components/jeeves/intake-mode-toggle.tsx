"use client";

/**
 * Mode toggle for /initiatives/new (ui-spec §4 M2 Breadth): "Structured form"
 * vs "Chat with intake assistant". Uses the existing `@/components/ui/tabs`
 * primitive (base-ui) so each mode is reachable by accessible name via
 * `getByRole("tab", {name: ...})` in tests.
 */
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EMPTY_PAYLOAD, IntakeForm } from "./intake-form";
import { IntakeChat } from "./intake-chat";
import type { IntakePayload } from "@/lib/intake/types";

export function IntakeModeToggle({ initialPayload, initiativeId, initialVersion, initialSlug }: {
  initialPayload?: IntakePayload;
  initiativeId?: string;
  initialVersion?: number;
  initialSlug?: string;
}) {
  const [mode, setMode] = React.useState("structured");
  const [payload, setPayload] = React.useState(initialPayload ?? EMPTY_PAYLOAD);
  return (
    <Tabs value={mode} onValueChange={setMode} data-slot="intake-mode-toggle">
      <TabsList>
        <TabsTrigger value="structured">Structured form</TabsTrigger>
        <TabsTrigger value="chat">Chat with intake assistant</TabsTrigger>
      </TabsList>
      <TabsContent value="structured" keepMounted>
        <IntakeForm initialPayload={payload} onPayloadChange={setPayload} initiativeId={initiativeId} initialVersion={initialVersion} initialSlug={initialSlug} />
      </TabsContent>
      <TabsContent value="chat" keepMounted>
        <IntakeChat payload={payload} onPayloadChange={setPayload} onReview={() => setMode("structured")} />
      </TabsContent>
    </Tabs>
  );
}
