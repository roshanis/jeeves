"use client";

/**
 * Natural-language audit chat (ui-spec §6 M2 Breadth; POST /api/chat/auditor).
 * Sits BELOW the existing canned-query AuditConsole as a separate, testable
 * component — the console itself is untouched.
 *
 * Session-gated for ANY authenticated persona (the route's own doc comment:
 * "an auditor question is a read/explain action, not a role-restricted
 * mutation"). Without a live session, the input + submit are disabled with
 * the standard passcode-tooltip messaging; `DisableWithTooltip` only renders
 * a `<Button>` though, so for a text input this component wraps the
 * input+button pair directly in `Tooltip`/`TooltipTrigger`/`TooltipContent`
 * using the same exact tooltip copy (`DEMO_PASSCODE_TOOLTIP`) rather than
 * reusing `DisableWithTooltip` itself (judgment call — documented here and
 * in the task report).
 *
 * SECURITY: `answerMd` is untrusted model output and MUST be rendered as
 * escaped plain text only (a `whitespace-pre-wrap` text node) — never
 * `dangerouslySetInnerHTML`, never parsed as markdown/HTML.
 */
import * as React from "react";
import { toast } from "sonner";
import { askAuditor, isApiError, apiErrorToMessage } from "@/lib/client/api";
import { useLiveSession } from "@/lib/client/session-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DEMO_PASSCODE_TOOLTIP } from "./role-gate";

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  citedEvents?: string[];
  queryUsed?: string;
}

export function AuditorChat() {
  const { session, logout } = useLiveSession();
  const [question, setQuestion] = React.useState("");
  const [transcript, setTranscript] = React.useState<ChatTurn[]>([]);
  const [pending, setPending] = React.useState(false);

  const disabled = !session;

  async function handleSubmit() {
    if (!session) return;
    const trimmed = question.trim();
    if (trimmed.length === 0) return;

    setTranscript((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuestion("");
    setPending(true);
    try {
      const result = await askAuditor(session.token, { question: trimmed });
      setTranscript((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answerMd,
          citedEvents: result.citedEvents,
          queryUsed: result.queryUsed,
        },
      ]);
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

  return (
    <Card size="sm" data-slot="auditor-chat">
      <CardHeader>
        <CardTitle className="text-sm">Ask the auditor</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          Ask a free-form question in plain English — answers are grounded in
          the same queryable evidence as the canned queries above.
        </p>

        {transcript.length > 0 ? (
          <div className="flex flex-col gap-3" data-slot="auditor-transcript">
            {transcript.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="text-sm font-medium">
                  <span className="text-muted-foreground">You: </span>
                  {turn.content}
                </div>
              ) : (
                <div key={i} className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <div
                    data-slot="auditor-answer"
                    className="whitespace-pre-wrap text-sm"
                  >
                    {turn.content}
                  </div>
                  {turn.citedEvents && turn.citedEvents.length > 0 ? (
                    <ul data-slot="auditor-cited-events" className="flex flex-col gap-0.5">
                      {turn.citedEvents.map((eventId, j) => (
                        <li key={j} className="font-mono text-xs text-muted-foreground">
                          {eventId}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {turn.queryUsed ? (
                    <p data-slot="auditor-query-used" className="text-xs text-muted-foreground">
                      Query used: {turn.queryUsed}
                    </p>
                  ) : null}
                </div>
              ),
            )}
          </div>
        ) : null}

        {disabled ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <div className="flex items-center gap-2" tabIndex={0}>
                  <input
                    disabled
                    placeholder="Ask a question about audit history…"
                    data-slot="auditor-question-input"
                    className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  <Button type="button" disabled data-slot="auditor-submit">
                    Ask
                  </Button>
                </div>
              }
            />
            <TooltipContent>{DEMO_PASSCODE_TOOLTIP}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !pending) {
                  e.preventDefault();
                  void handleSubmit();
                }
              }}
              placeholder="Ask a question about audit history…"
              maxLength={2000}
              data-slot="auditor-question-input"
              className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button
              type="button"
              disabled={pending || question.trim().length === 0}
              onClick={() => void handleSubmit()}
              data-slot="auditor-submit"
            >
              {pending ? "Asking…" : "Ask"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
