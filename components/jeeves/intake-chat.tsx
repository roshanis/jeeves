"use client";

/**
 * Conversational intake assistant (ui-spec §4 M2 Breadth; intake-spec §1;
 * POST /api/chat/intake) — the chat-based alternative to the structured
 * `IntakeForm`. Produces the same `IntakePayload` shape by conversation
 * instead of form fields.
 *
 * Session-gated for the REQUESTER role specifically (route doc comment:
 * "Session-gated (requester)"). Mirrors intake-form.tsx's own read-only /
 * wrong-role Alert-block precedent for the no-session / non-requester cases.
 *
 * Judgment call (documented per task brief): the completeness display is
 * driven by the route's OWN `gaps` field directly (not recomputed client-side
 * via `evaluateCompleteness`), since the server already computes both `gaps`
 * and `done` from the exact same `evaluateCompleteness(updatedPayload)` call
 * — using the server's response as-is keeps this component from silently
 * drifting out of sync with the server's tier-aware evaluation (which this
 * component has no `preview`/tier input to reproduce anyway, unlike
 * IntakeForm's live tier preview). The two tiny lookup consts
 * (`GAP_LEVEL_LABEL`/`GAP_LEVEL_CLASS`) are duplicated from intake-form.tsx
 * rather than factored into a shared export, per the task brief's explicit
 * allowance ("duplication is fine here, it's 2 tiny const objects").
 */
import * as React from "react";
import { toast } from "sonner";
import type { CompletenessGap } from "@/lib/intake/completeness";
import { intakeChat, isApiError, apiErrorToMessage } from "@/lib/client/api";
import { useLiveSession } from "@/lib/client/session-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

const GAP_LEVEL_LABEL: Record<CompletenessGap["level"], string> = {
  BLOCKING: "Blocking",
  REQUIRED_FOR_TIER: "Required for tier",
  ADVISORY: "Advisory",
};

const GAP_LEVEL_CLASS: Record<CompletenessGap["level"], string> = {
  BLOCKING: "text-destructive",
  REQUIRED_FOR_TIER: "text-amber-700 dark:text-amber-400",
  ADVISORY: "text-muted-foreground",
};

export function IntakeChat() {
  const { session, logout } = useLiveSession();
  const isRequester = session?.role === "requester";

  const [conversation, setConversation] = React.useState<ConversationTurn[]>([]);
  const [partialPayload, setPartialPayload] = React.useState<Record<string, unknown>>({});
  const [message, setMessage] = React.useState("");
  const [gaps, setGaps] = React.useState<CompletenessGap[]>([]);
  const [done, setDone] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  const gapsByLevel = (level: CompletenessGap["level"]) =>
    gaps.filter((g) => g.level === level);

  async function handleSubmit() {
    if (!session || !isRequester) return;
    const trimmed = message.trim();
    if (trimmed.length === 0) return;

    const nextConversation: ConversationTurn[] = [
      ...conversation,
      { role: "user", content: trimmed },
    ];
    setConversation(nextConversation);
    setMessage("");
    setPending(true);
    try {
      const result = await intakeChat(session.token, {
        conversation: nextConversation,
        partialPayload,
      });
      setConversation((prev) => [...prev, { role: "assistant", content: result.reply }]);
      setPartialPayload(result.updatedPayload as unknown as Record<string, unknown>);
      setGaps(result.gaps);
      setDone(result.done);
    } catch (err) {
      if (isApiError(err)) {
        toast.error(apiErrorToMessage(err));
        if (err.status === 401) {
          logout();
        }
      } else {
        toast.error("Something went wrong — please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  if (!session) {
    return (
      <Alert data-slot="intake-chat">
        <AlertTitle>Read-only mode</AlertTitle>
        <AlertDescription>
          Enter demo passcode to chat with the intake assistant — this mode is
          only available with a live demo session active (use the chip in the
          header).
        </AlertDescription>
      </Alert>
    );
  }

  if (!isRequester) {
    return (
      <Alert data-slot="intake-chat">
        <AlertTitle>Viewing as {session.personaLabel}</AlertTitle>
        <AlertDescription>
          You are viewing intake as {session.role} — only Requesters may use
          the conversational intake assistant. Switch to a requester persona
          via the demo mode chip to continue.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]" data-slot="intake-chat">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Chat with the intake assistant</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3" data-slot="intake-chat-transcript">
            {conversation.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Describe the initiative you want to submit — the assistant
                will ask follow-up questions until the intake is complete.
              </p>
            ) : (
              conversation.map((turn, i) => (
                <div key={i} className="text-sm">
                  <span className="font-medium text-muted-foreground">
                    {turn.role === "user" ? "You: " : "Assistant: "}
                  </span>
                  <span className="whitespace-pre-wrap">{turn.content}</span>
                </div>
              ))
            )}
          </div>

          {done ? (
            <Badge variant="secondary" data-slot="intake-chat-done">
              Intake complete — no blocking gaps remain
            </Badge>
          ) : null}

          <div className="flex items-center gap-2">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Tell the assistant about your initiative…"
              maxLength={4000}
              data-slot="intake-chat-input"
              className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button
              type="button"
              disabled={pending || message.trim().length === 0}
              onClick={() => void handleSubmit()}
              data-slot="intake-chat-submit"
            >
              {pending ? "Sending…" : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm" data-slot="completeness-meter">
        <CardHeader>
          <CardTitle className="text-sm">Completeness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {gaps.length === 0 && conversation.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Gaps will show here once the conversation begins.
            </p>
          ) : (
            (["BLOCKING", "REQUIRED_FOR_TIER", "ADVISORY"] as const).map((level) => {
              const levelGaps = gapsByLevel(level);
              if (levelGaps.length === 0) return null;
              return (
                <div key={level} className="space-y-1">
                  <p className={`text-xs font-medium uppercase ${GAP_LEVEL_CLASS[level]}`}>
                    {GAP_LEVEL_LABEL[level]} ({levelGaps.length})
                  </p>
                  <ul className="space-y-1">
                    {levelGaps.map((gap) => (
                      <li
                        key={gap.ruleId}
                        className={`text-xs ${GAP_LEVEL_CLASS[level]}`}
                        data-slot="completeness-gap"
                        data-rule={gap.ruleId}
                        data-level={gap.level}
                      >
                        <span className="font-mono">{gap.ruleId}</span> — {gap.message}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
