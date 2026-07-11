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

export function IntakeModeToggle() {
  return (
    <Tabs defaultValue="structured" data-slot="intake-mode-toggle">
      <TabsList>
        <TabsTrigger value="structured">Structured form</TabsTrigger>
        <TabsTrigger value="chat">Chat with intake assistant</TabsTrigger>
      </TabsList>
      <TabsContent value="structured">
        <IntakeForm />
      </TabsContent>
      <TabsContent value="chat">
        <IntakeChat />
      </TabsContent>
    </Tabs>
  );
}
