"use client";

/**
 * Structured intake form for /initiatives/new (ui-spec §4, intake-spec §1).
 *
 * - Live tier preview: calls the REAL deriveTier/requiredDomains via
 *   lib/client/tier-preview.ts (never a reimplementation) as the 6 overlay
 *   questions are answered.
 * - Completeness meter: calls the REAL evaluateCompleteness
 *   (lib/intake/completeness.ts) on every change; BLOCKING gaps gate the
 *   submit button, REQUIRED-FOR-TIER/ADVISORY gaps render as warnings only
 *   (existing incomplete drafts can still submit with tier-level gaps).
 * - "Use a sample initiative" (demo only) populates the whole form from
 *   SAMPLE_INITIATIVE_PAYLOAD, including optional context and retention.
 * - Read-only public mode (no live session): fields render but are
 *   non-interactive (one <fieldset disabled> wrapper) and Submit is the
 *   standard disabled-with-tooltip gate (ui-spec §4 states / §8.4).
 * - Live mode: Submit runs create -> submit through the real API and
 *   routes to the new initiative's detail page.
 * - "Save draft" keeps unfinished work. A requester persona saves through the
 *   same create / edit-draft routes as Submit (no completeness gate, a title is
 *   enough) and lands on the edit page. A real request (`public`) saves ONLY to
 *   this tab's sessionStorage: nothing is sent until Submit, and the copy is
 *   restored into a public session in the same tab, never into a persona.
 * - Leave warning: beforeunload, plus a confirm on plain same-origin link
 *   clicks, while there are unsaved changes (a real request also stays armed
 *   while unsent content exists). It is off after a successful save (persona)
 *   or submit. NOT covered: browser Back/Forward, command-palette navigation
 *   (Cmd/Ctrl-K), and any session change on the edit page (expiry, Exit demo,
 *   persona switch, a 401 on save).
 * - The sample button is hidden for real requests; loading it over typed
 *   content asks first.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { IntakePayload } from "@/lib/intake/types";
import { EMPTY_INTAKE_PAYLOAD as EMPTY_PAYLOAD } from "@/lib/intake/defaults";
import { ADDITIONAL_INTAKE_QUESTIONS, ADDITIONAL_ANSWER_MAX_LENGTH } from "@/lib/intake/additional-questions";
import {
  evaluateCompleteness,
  type CompletenessGap,
} from "@/lib/intake/completeness";
import { SAMPLE_INITIATIVE_PAYLOAD } from "@/lib/intake/champion-prefill";
import Link from "next/link";
import { INTAKE_LIMITS, intakePayloadSchema } from "@/lib/intake/schema";
import { SELF_HOSTED, withCurrentHosting } from "@/lib/intake/hosting";
import { previewTier } from "@/lib/client/tier-preview";
import {
  createInitiative,
  createIntakeRequestId,
  updateIntakeDraft,
  submitIntake,
  isApiError,
  apiErrorToMessage,
} from "@/lib/client/api";
import { useLiveSession } from "@/lib/client/session-context";
import { useDeploymentMode } from "@/lib/client/deployment-mode-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { DisableWithTooltip } from "./role-gate";
import { TierBadge } from "./tier-badge";
import { DOMAIN_LABEL } from "./domain-labels";

/* -------------------------------------------------------------------------
 * Field metadata (intake-spec §1)
 * ---------------------------------------------------------------------- */

const EXPECTED_VOLUMES = ["<100/mo", "100-1k/mo", "1k-10k/mo", "10k-100k/mo", ">100k/mo"] as const;
const PHI_CATEGORIES = [
  "Demographics",
  "Diagnosis/ICD codes",
  "Medications",
  "Clinical notes/free text",
  "Claims/billing",
  "Lab results",
  "Images",
  "Other",
] as const;
const RETENTION_INTENTS = [
  "Session-only (no persistence)",
  "<=30 days",
  "<=1 year",
  ">1 year",
  "Indefinite/per-record-schedule",
] as const;
const TRAINING_VS_INFERENCE = ["Inference-only", "Fine-tuning/training", "Both"] as const;
const BUILD_OR_BUY = ["Build (internal)", "Buy (vendor)", "Hybrid"] as const;
const HOSTING = ["Vendor-hosted", SELF_HOSTED] as const;
const MODEL_TYPES = [
  "LLM (generative)",
  "Classical ML / classifier",
  "OCR/extraction",
  "Rules engine",
  "Other",
] as const;

/** Verbatim overlay questions + helper lines (intake-spec §1g). */
const OVERLAY_QUESTIONS: {
  key: keyof IntakePayload["overlay"];
  question: string;
  helper: string;
}[] = [
  {
    key: "touchesPHI",
    question: "Does it access PHI?",
    helper:
      "Determines Privacy/HIPAA control applicability (H-01, H-02) and drives the PHI-category/retention questions above.",
  },
  {
    key: "memberFacing",
    question: "Do members interact with or receive its output directly?",
    helper:
      "Member-facing systems carry higher individual-impact and consumer-protection exposure, and add Legal review (L-02).",
  },
  {
    key: "careCoverageInfluence",
    question: "Does it influence care or coverage decisions?",
    helper:
      "The single strongest driver of tier — care/coverage influence without a human check is Critical (tier rule 1).",
  },
  {
    key: "vendorHosted",
    question: "Is the model vendor-hosted?",
    helper:
      "Vendor hosting triggers Procurement and Legal control requirements (contract addendum, VRA, data-residency attestation).",
  },
  {
    key: "humanInTheLoop",
    question: "Does a qualified human review each output before it takes effect?",
    helper:
      "A human-in-the-loop check downgrades otherwise-Critical care/coverage cases to High (tier rule 2) — it is a mitigating control, not a formality.",
  },
  {
    key: "individualImpact",
    question:
      "Does it affect individuals' opportunities, rights, or services (members, providers, or employees)?",
    helper:
      "Individual-impact combined with member-facing is an independent High-tier trigger, and feeds Medium-tier default even absent other flags.",
  },
];

/* -------------------------------------------------------------------------
 * Small presentational helpers
 * ---------------------------------------------------------------------- */

const inputClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";
const textareaClass =
  "min-h-20 rounded-lg border border-input bg-transparent p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60";

function TextField({
  label,
  value,
  onChange,
  type = "text",
  hint,
  maxLength,
  required,
  gapIds,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
  maxLength?: number;
  required?: boolean;
  gapIds?: string[];
}) {
  const hintId = React.useId();
  const describedBy = [hint ? hintId : "", ...(gapIds ?? [])].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        <input
          type={type}
          value={value}
          maxLength={maxLength}
          required={required}
          aria-invalid={gapIds?.length ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      </label>
      {hint ? <span id={hintId} className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
  maxLength,
  required,
  gapIds,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  maxLength?: number;
  required?: boolean;
  gapIds?: string[];
}) {
  const hintId = React.useId();
  const describedBy = [hint ? hintId : "", ...(gapIds ?? [])].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">{label}</span>
        <textarea
          value={value}
          maxLength={maxLength}
          required={required}
          aria-invalid={gapIds?.length ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          className={textareaClass}
        />
      </label>
      {hint ? <span id={hintId} className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// One-per-line list field. The raw text lives here so spaces and line breaks
// survive while typing; the parent only ever sees the trimmed entries. When
// the entries change from outside (a sample prefill) the text is resynced.
function LinesField({
  label,
  values,
  onChange,
  required,
  gapIds,
}: {
  label: string;
  values: string[];
  onChange: (entries: string[]) => void;
  required?: boolean;
  gapIds?: string[];
}) {
  const [text, setText] = React.useState(values.join("\n"));
  const [seen, setSeen] = React.useState(values);
  if (seen !== values) {
    setSeen(values);
    if (splitLines(text).join("\n") !== values.join("\n")) setText(values.join("\n"));
  }
  return (
    <TextAreaField
      label={label}
      value={text}
      required={required}
      gapIds={gapIds}
      onChange={(v) => {
        setText(v);
        onChange(splitLines(v));
      }}
    />
  );
}

function AdditionalQuestions<K extends string>({ questions, values, onChange }: {
  questions: readonly { key: K; question: string; hint: string }[];
  values: Partial<Record<K, string | null>>;
  onChange: (key: K, value: string | null) => void;
}) {
  const id = React.useId();
  return <div className="col-span-full flex flex-col gap-3">
    <p className="text-xs text-muted-foreground">Additional questions (optional). Share what you know; you can leave unanswered questions blank.</p>
    {questions.map(({ key, question, hint }) => (
      <div key={key} className="flex flex-col gap-1 text-sm">
        <label htmlFor={`${id}-${key}`} className="font-medium">{question}</label>
        <textarea
          id={`${id}-${key}`}
          aria-describedby={`${id}-${key}-hint`}
          value={values[key] ?? ""}
          maxLength={ADDITIONAL_ANSWER_MAX_LENGTH}
          onChange={(event) => onChange(key, event.target.value.trim() === "" ? null : event.target.value)}
          className={textareaClass}
        />
        <span id={`${id}-${key}-hint`} className="text-xs text-muted-foreground">{hint} Optional, up to {ADDITIONAL_ANSWER_MAX_LENGTH} characters.</span>
      </div>
    ))}
  </div>;
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly T[];
  onChange: (value: T | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as T))}
        className={inputClass}
      >
        <option value="">— select —</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
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

/* -------------------------------------------------------------------------
 * Unsaved-work helpers
 * ---------------------------------------------------------------------- */

/** sessionStorage key for a real request saved in this tab (never sent). */
export const PUBLIC_DRAFT_KEY = "jeeves_public_intake_draft";
const LEAVE_MESSAGE = "You have unsaved changes to this intake. Leave this page and lose them?";

const samePayload = (a: IntakePayload, b: IntakePayload) => JSON.stringify(a) === JSON.stringify(b);

function readPublicDraft(): IntakePayload | null {
  try {
    const raw = window.sessionStorage.getItem(PUBLIC_DRAFT_KEY);
    if (!raw) return null;
    const parsed = intakePayloadSchema.safeParse(withCurrentHosting((JSON.parse(raw) as { payload?: unknown } | null)?.payload));
    return parsed.success ? (parsed.data as IntakePayload) : null;
  } catch {
    return null;
  }
}

function writePublicDraft(payload: IntakePayload): boolean {
  try {
    window.sessionStorage.setItem(PUBLIC_DRAFT_KEY, JSON.stringify({ payload, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

const subscribeNoop = () => () => {};

/** Cheap presence check for the tab copy; validation is left to the restore path. */
function hasTabDraftCopy(): boolean {
  try {
    return window.sessionStorage.getItem(PUBLIC_DRAFT_KEY) !== null;
  } catch {
    return false;
  }
}

function clearPublicDraft() {
  try {
    window.sessionStorage.removeItem(PUBLIC_DRAFT_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/* -------------------------------------------------------------------------
 * The form
 * ---------------------------------------------------------------------- */

export function IntakeForm({ initialPayload, onPayloadChange, initiativeId: initialInitiativeId, initialVersion, initialSlug, realRequestsEnabled = true }: {
  initialPayload?: IntakePayload;
  onPayloadChange?: (payload: IntakePayload) => void;
  initiativeId?: string;
  initialVersion?: number;
  initialSlug?: string;
  /** False when no operator queue is configured: nobody could read a real request, so that door is not offered. */
  realRequestsEnabled?: boolean;
} = {}) {
  const router = useRouter();
  const { session, logout, expired, startDemo, startPublicSession, pending } = useLiveSession();
  const mode = useDeploymentMode();

  const [internalPayload, setInternalPayload] = React.useState<IntakePayload>(initialPayload ?? EMPTY_PAYLOAD);
  const payload = initialPayload ?? internalPayload;
  const [busy, setBusy] = React.useState<"save" | "submit" | null>(null);
  // Synchronous in-flight guard: state alone lets two quick clicks both start.
  const busyRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  // Set once the request has been sent or the draft saved, so the leave
  // warning stays quiet during the navigation that follows.
  const leavingRef = React.useRef(false);
  const [status, setStatus] = React.useState<string | null>(null);
  // Read from sessionStorage without an effect; the server snapshot is false.
  const hasTabDraft = React.useSyncExternalStore(subscribeNoop, hasTabDraftCopy, () => false);
  const [initiativeId, setInitiativeId] = React.useState(initialInitiativeId);
  const [version, setVersion] = React.useState(initialVersion);
  const [slug, setSlug] = React.useState(initialSlug);
  const [savedPayload, setSavedPayload] = React.useState<IntakePayload | null>(initialPayload ?? null);
  // What the server holds for this form (a public session's savedPayload means
  // only "tab copy written", so the skip-the-update check cannot use it).
  const serverPayload = React.useRef<IntakePayload | null>(initialPayload ?? null);
  const requestId = React.useRef<string | null>(null);
  const creationPayload = React.useRef<IntakePayload | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // A new session in another workspace (an expired real-request session, then
  // "Send a real request" again) cannot see the old draft: forget it so the
  // next submit re-creates it from the form instead of updating a 404.
  const draftWorkspaceId = React.useRef<string | undefined>(undefined);
  const sessionWorkspaceId = session?.workspaceId;
  React.useEffect(() => {
    if (!sessionWorkspaceId) return;
    if (draftWorkspaceId.current && draftWorkspaceId.current !== sessionWorkspaceId) {
      setInitiativeId(undefined);
      setVersion(undefined);
      setSlug(undefined);
      setSavedPayload(null);
      serverPayload.current = null;
      requestId.current = null;
      creationPayload.current = null;
    }
    draftWorkspaceId.current = sessionWorkspaceId;
  }, [sessionWorkspaceId]);

  const patch = React.useCallback((update: (prev: IntakePayload) => IntakePayload) => {
    const next = update(payload);
    if (onPayloadChange) onPayloadChange(next);
    else setInternalPayload(next);
  }, [onPayloadChange, payload]);

  // "Pristine" = the form exactly as it was opened. Reference equality is
  // enough: patch() always produces a NEW payload object, and loadChampion()
  // swaps in the prefill, so the identity check flips on first interaction
  // without threading a setter through every field.
  //
  // It gates FRAMING only, never content or the submit gate: an untouched
  // form still lists every gap and still carries data-level="BLOCKING", but
  // presents them as work remaining rather than as 11 red failures for
  // fields the visitor has not had a chance to fill (and, in the default
  // read-only mode, is not permitted to fill).
  //
  // Every field edit — including the multi-line ones, which PR #7 rewired to
  // derive their value straight from the payload arrays rather than holding
  // separate raw-text state — now flows through patch(), so this single
  // identity check covers the whole form. In draft-edit mode `initialPayload`
  // is supplied and this is false from the start, which is right: a loaded
  // draft is not a pristine blank form.
  const pristine = payload === EMPTY_PAYLOAD;

  function loadChampion() {
    if (
      !samePayload(payload, EMPTY_PAYLOAD) &&
      !samePayload(payload, SAMPLE_INITIATIVE_PAYLOAD) &&
      !window.confirm("Replace everything in this form with the sample initiative?")
    ) return;
    loadPayload(SAMPLE_INITIATIVE_PAYLOAD);
  }

  function loadPayload(next: IntakePayload) {
    if (onPayloadChange) onPayloadChange(next);
    else setInternalPayload(next);
  }

  const preview = previewTier(payload.overlay);
  const completeness = evaluateCompleteness(payload, preview?.tier);
  const gapsByLevel = (level: CompletenessGap["level"]) =>
    completeness.gaps.filter((g) => g.level === level);
  // Ids of the blocking-gap rows that name a field, so the control can point
  // at them. Nothing is flagged while the form is still untouched.
  const gapIdsFor = (field: string) =>
    pristine
      ? undefined
      : completeness.gaps
          .filter((g) => g.level === "BLOCKING" && g.field.split(",").includes(field))
          .map((g) => `intake-gap-${g.ruleId}`);

  // Who may author an intake: a requester persona (the playground) or a
  // `public` session (a real request to the operator). The public role can
  // fill in and submit this form and nothing else — enforced server-side by
  // runMutationGuard's deny-by-default in lib/services/route-guard.ts.
  const canAuthorIntake = session?.role === "requester" || session?.role === "public";
  const isRequester = canAuthorIntake;

  // Unsaved = differs from what was last saved (an untouched form counts as
  // saved). A real request also counts as unsent while it holds content that
  // is neither blank nor the sample, even right after a tab-local save: closing
  // the tab destroys sessionStorage, and the server has never seen it.
  const isPublic = session?.role === "public";
  const unsaved = !samePayload(payload, savedPayload ?? EMPTY_PAYLOAD);
  const isSample = samePayload(payload, SAMPLE_INITIATIVE_PAYLOAD);
  const linkArmed = unsaved && !isSample;
  const titleHintShown = Boolean(session && isRequester && unsaved && !isPublic && payload.basics.title.trim() === "");
  const titleHintId = `${React.useId()}-title-hint`;
  // A real request stays armed while unsent content exists, and so does a saved
  // tab copy once the session has expired (closing the tab discards it). With a
  // persona session the tab copy is not this form's work, so it never arms.
  const unloadArmed =
    linkArmed || ((isPublic || (!session && hasTabDraft)) && !samePayload(payload, EMPTY_PAYLOAD) && !isSample);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    if (!unloadArmed) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unloadArmed]);

  React.useEffect(() => {
    if (!linkArmed) return;
    const onClick = (event: MouseEvent) => {
      if (leavingRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      // Native confirm: no focus trap, and Escape or Enter work as in any dialog.
      if (!window.confirm(LEAVE_MESSAGE)) event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [linkArmed]);

  // Entering the real-request door: bring back what this tab saved, and drop a
  // sample loaded in the no-session preview (a sample must never become the
  // text of a real request). Typed content is never replaced.
  const publicDoor = isPublic && !initialInitiativeId;
  function restoreTabDraft(stored: IntakePayload) {
    loadPayload(stored);
    setSavedPayload(stored);
    setStatus("Restored the request you saved in this tab. Not sent yet.");
  }
  React.useEffect(() => {
    if (!publicDoor) return;
    if (samePayload(payload, EMPTY_PAYLOAD) || isSample) {
      const stored = readPublicDraft();
      if (stored) {
        // Syncing from an external system (sessionStorage) once, when the session starts.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        restoreTabDraft(stored);
        return;
      }
    }
    if (isSample) loadPayload(EMPTY_PAYLOAD);
    // Runs when the real-request session starts; later edits must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicDoor, session?.token]);

  function handleStartPublic() {
    setError(null);
    // Pending state and the error message are owned by the session context,
    // shared with the demo entry button, so the two doors cannot race.
    return startPublicSession().catch(() => {
      setError("Could not start a request just now. Please try again in a moment.");
    });
  }

  async function persistToServer(token: string) {
    requestId.current ??= createIntakeRequestId();
    creationPayload.current ??= payload;
    let created = initiativeId && version
      ? serverPayload.current && samePayload(serverPayload.current, payload)
        ? { initiativeId, slug: slug ?? initiativeId, intakeVersionId: "", version }
        : await updateIntakeDraft(token, initiativeId, payload, version)
      : await createInitiative(
          token,
          creationPayload.current ?? payload,
          requestId.current,
        ).catch((err: unknown) => {
          // A definitive rejection (not a lost response, 5xx or 429) means
          // nothing was created: the next attempt must send what the user
          // has now, under a fresh idempotency key. 409 is in the list on
          // purpose: for a create it means the key was already used with a
          // different payload, so replaying the pinned key and payload would
          // repeat the 409 forever. A fresh key can leave an earlier draft
          // behind in the visitor's own workspace, which is the lesser problem.
          if (isApiError(err) && [400, 403, 404, 409, 413, 422].includes(err.status)) {
            requestId.current = null;
            creationPayload.current = null;
          }
          throw err;
        });
    if (!initiativeId && JSON.stringify(creationPayload.current) !== JSON.stringify(payload)) {
      created = await updateIntakeDraft(
        token,
        created.initiativeId,
        payload,
        created.version,
      );
    }
    setInitiativeId(created.initiativeId);
    setSlug(created.slug);
    setVersion(created.version);
    serverPayload.current = payload;
    if (session?.role !== "public") setSavedPayload(payload);
    return created;
  }

  function reportError(err: unknown) {
    if (isApiError(err)) {
      const message = err.status === 409
        ? err.code === "INTAKE_NOT_EDITABLE"
          ? "This intake was already submitted and can no longer be edited. Open its case file from your initiatives list."
          : "This draft changed in another tab. Reloading discards what you typed here, so copy your text first."
        : apiErrorToMessage(err);
      setError(message);
      toast.error(message);
      if (err.status === 401) {
        logout();
      }
    } else {
      setError("Something went wrong — please try again.");
      toast.error("Something went wrong — please try again.");
    }
  }

  async function handleSubmit() {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setBusy("submit");
    setError(null);
    try {
      // A real request is kept in this tab before it is sent, so a failed or
      // lost send does not lose what the visitor typed.
      if (session.role === "public") writePublicDraft(payload);
      const created = await persistToServer(session.token);
      const submitted = await submitIntake(session.token, created.initiativeId);
      if (submitted.submitted) {
        leavingRef.current = true;
        if (session.role === "public") clearPublicDraft();
        // A public submitter goes to the confirmation page, not the case
        // file: the case file is an operations console full of internal
        // governance state, and dropping a member of the public into it
        // answers none of the questions they actually have.
        if (session.role === "public") {
          // Not "the Program Office": in the playground anyone can play that
          // persona. A real request goes to the people running this site.
          toast.success("Request sent — the team running this site will reply by email.");
          router.push("/thank-you");
        } else {
          toast.success(
            `Intake submitted — completeness ${submitted.completenessPct}%. Running the governance flow from here.`,
          );
          router.push(`/initiatives/${created.slug}`);
        }
      } else {
        // BLOCKING gaps server-side (should match the client meter, which
        // already gates submit — but the server stays the source of truth).
        toast.error(
          `Submission blocked: ${submitted.gaps.map((g) => g.message).join(" ")}`,
        );
      }
    } catch (err) {
      reportError(err);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  async function handleSaveDraft() {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setBusy("save");
    setError(null);
    try {
      if (session.role === "public") {
        if (writePublicDraft(payload)) {
          setSavedPayload(payload);
          setStatus("Not sent yet. Saved in this tab only; submit to send it to the team.");
        } else {
          setError("Could not save in this browser. Keep this tab open and submit when ready.");
        }
        return;
      }
      const created = await persistToServer(session.token);
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setStatus(`Draft saved at ${time}.`);
      toast.success("Draft saved.");
      // Only a brand-new form moves: the edit page is already the draft's home.
      // A slow save must not pull the visitor back after they have left.
      if (!initialInitiativeId && mountedRef.current) {
        leavingRef.current = true;
        router.replace(`/initiatives/${created.slug}/edit`);
      }
    } catch (err) {
      reportError(err);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      data-slot="intake-form"
    >
      <div className="flex flex-col gap-4">
        {!session && expired && mode === "production" ? (
          <Alert variant="destructive" role="status">
            <AlertTitle>Your session expired</AlertTitle>
            <AlertDescription>
              {pristine ? null : "What you typed is still on this page. "}Sign in again, then submit again.
            </AlertDescription>
          </Alert>
        ) : !session && expired ? (
          <Alert variant="destructive" role="status">
            <AlertTitle>Your session expired</AlertTitle>
            <AlertDescription>
              {pristine ? null : "What you typed is still on this page. "}Use{" "}
              {expired.kind === "public" && realRequestsEnabled ? "“Send a real request”" : "“Start the demo”"}{" "}
              below to start a new session, then submit again.
            </AlertDescription>
          </Alert>
        ) : null}
        {!session && mode === "production" ? (
          <Alert>
            <AlertTitle>Sign in to create an initiative</AlertTitle>
            <AlertDescription>
              <Link className="font-medium text-primary underline" href="/sign-in">Sign in</Link>{" "}
              to fill in and submit an intake.
            </AlertDescription>
          </Alert>
        ) : !session ? (
          <Alert>
            <AlertTitle>{realRequestsEnabled ? "Try it, or send a real request" : "Try the demo"}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2.5">
              {realRequestsEnabled ? (
                <span>
                  There are two ways in, and they go to different places.
                </span>
              ) : null}
              <div className="flex flex-col gap-1.5">
                <span>
                  <span className="font-medium text-foreground">Try the demo</span>{" "}
                  — fill in a fictional initiative, then switch roles to review
                  and approve it yourself. It stays in your own sandbox;
                  nobody else sees it.
                </span>
                {realRequestsEnabled ? (
                  <span>
                    <span className="font-medium text-foreground">Send a real request</span>{" "}
                    — it goes to the team running this site, who read every one
                    and reply by email to the address you give.
                    {hasTabDraft ? " You have an unsent request saved in this tab; choose this to continue it." : ""}
                  </span>
                ) : null}
              </div>
              {/* Said plainly because strangers are about to type into a form
                  themed as a healthcare payer's intake. This is a synthetic
                  demo and the cheapest control available is telling them. */}
              <span className="font-medium">
                Either way, do not enter real personal, member or health
                information — this is a demonstration system.
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={startDemo}
                  disabled={pending}
                  data-slot="intake-unlock"
                >
                  Start the demo
                </Button>
                {realRequestsEnabled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleStartPublic()}
                    disabled={pending}
                    data-slot="start-public-request"
                  >
                    Send a real request
                  </Button>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        ) : session.role === "public" ? (
          <Alert>
            <AlertTitle>Sending a real request</AlertTitle>
            <AlertDescription>
              This goes to the team running this site, not into the demo. Fill
              in what you can — include an email address you check — and
              submit. Do not enter real personal, member or health information.
            </AlertDescription>
          </Alert>
        ) : !isRequester ? (
          <Alert>
            <AlertTitle>Viewing as {session.personaLabel}</AlertTitle>
            <AlertDescription>
              You are viewing intake as {session.role} — only Requesters may
              create and submit new initiatives.
              {mode === "production" ? null : " Switch to a requester persona using the persona picker in the header to submit."}
            </AlertDescription>
          </Alert>
        ) : null}

        {mode === "production" || isPublic ? null : (
          <div>
            <Button type="button" variant="outline" onClick={loadChampion} disabled={busy !== null} data-slot="load-champion">
              Use a sample initiative
            </Button>
          </div>
        )}

        <fieldset
          disabled={!isRequester || busy !== null}
          data-slot="intake-fieldset"
          className="flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Basics</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Initiative title"
                required
                gapIds={gapIdsFor("basics.title")}
                maxLength={INTAKE_LIMITS.short}
                value={payload.basics.title}
                onChange={(v) => patch((p) => ({ ...p, basics: { ...p.basics, title: v } }))}
              />
              <TextField
                label="Sponsor organization"
                required
                gapIds={gapIdsFor("basics.sponsorOrg")}
                maxLength={INTAKE_LIMITS.short}
                value={payload.basics.sponsorOrg}
                onChange={(v) => patch((p) => ({ ...p, basics: { ...p.basics, sponsorOrg: v } }))}
              />
              <TextField
                label="Requester name"
                required
                gapIds={gapIdsFor("basics.requesterName")}
                maxLength={INTAKE_LIMITS.short}
                value={payload.basics.requesterName}
                onChange={(v) =>
                  patch((p) => ({ ...p, basics: { ...p.basics, requesterName: v } }))
                }
              />
              <TextField
                label="Requester email"
                required
                gapIds={gapIdsFor("basics.requesterEmail")}
                maxLength={INTAKE_LIMITS.line}
                type="email"
                value={payload.basics.requesterEmail}
                onChange={(v) =>
                  patch((p) => ({ ...p, basics: { ...p.basics, requesterEmail: v } }))
                }
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Business problem"
                  required
                  gapIds={gapIdsFor("basics.businessProblem")}
                  maxLength={INTAKE_LIMITS.businessProblem}
                  value={payload.basics.businessProblem}
                  hint="Describe the problem being solved, not the solution (20–2000 chars)."
                  onChange={(v) =>
                    patch((p) => ({ ...p, basics: { ...p.basics, businessProblem: v } }))
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Use case &amp; users</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <TextField
                label="Who uses it"
                maxLength={INTAKE_LIMITS.line}
                value={payload.useCase.primaryUsers}
                onChange={(v) =>
                  patch((p) => ({ ...p, useCase: { ...p.useCase, primaryUsers: v } }))
                }
              />
              <TextField
                label="Decision it informs"
                maxLength={INTAKE_LIMITS.medium}
                value={payload.useCase.decisionInformed}
                hint="Name the concrete decision (e.g. coverage approval/denial recommendation)."
                onChange={(v) =>
                  patch((p) => ({ ...p, useCase: { ...p.useCase, decisionInformed: v } }))
                }
              />
              <SelectField
                label="Expected volume"
                value={payload.useCase.expectedVolume}
                options={EXPECTED_VOLUMES}
                onChange={(v) =>
                  patch((p) => ({ ...p, useCase: { ...p.useCase, expectedVolume: v } }))
                }
              />
              <AdditionalQuestions
                questions={ADDITIONAL_INTAKE_QUESTIONS.useCase}
                values={payload.useCase}
                onChange={(key, value) => patch((p) => ({ ...p, useCase: { ...p.useCase, [key]: value } }))}
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Data</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <LinesField
                label="Data source(s) — one per line"
                values={payload.data.dataSources}
                required
                gapIds={gapIdsFor("data.dataSources")}
                onChange={(entries) => {
                  patch((p) => ({ ...p, data: { ...p.data, dataSources: entries } }));
                }}
              />
              <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="font-medium">PHI categories touched</legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {PHI_CATEGORIES.map((category) => (
                    <label key={category} className="flex items-center gap-2 text-sm font-normal">
                      <input
                        type="checkbox"
                        checked={payload.data.phiCategories.includes(category)}
                        onChange={(e) => {
                          patch((p) => ({
                            ...p,
                            data: {
                              ...p.data,
                              phiCategories: e.target.checked
                                ? [...p.data.phiCategories, category]
                                : p.data.phiCategories.filter((c) => c !== category),
                              ...(category === "Other" && !e.target.checked ? { phiCategoriesOtherText: null } : {}),
                            },
                          }));
                        }}
                      />
                      {category}
                    </label>
                  ))}
                </div>
              </fieldset>
              {payload.data.phiCategories.includes("Other") ? (
                <TextField
                  label="Other PHI category"
                  maxLength={INTAKE_LIMITS.line}
                  value={payload.data.phiCategoriesOtherText ?? ""}
                  onChange={(v) =>
                    patch((p) => ({
                      ...p,
                      data: { ...p.data, phiCategoriesOtherText: v === "" ? null : v },
                    }))
                  }
                />
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField
                  label="Data retention intent"
                  value={payload.data.retentionIntent}
                  options={RETENTION_INTENTS}
                  onChange={(v) =>
                    patch((p) => ({ ...p, data: { ...p.data, retentionIntent: v } }))
                  }
                />
                <TextField
                  label="Retention note (optional)"
                  maxLength={INTAKE_LIMITS.medium}
                  value={payload.data.retentionIntentNote ?? ""}
                  onChange={(v) =>
                    patch((p) => ({
                      ...p,
                      data: { ...p.data, retentionIntentNote: v === "" ? null : v },
                    }))
                  }
                />
              </div>
              <SelectField
                label="Training vs. inference use"
                value={payload.data.trainingVsInference}
                options={TRAINING_VS_INFERENCE}
                onChange={(v) =>
                  patch((p) => ({ ...p, data: { ...p.data, trainingVsInference: v } }))
                }
              />
              <AdditionalQuestions
                questions={ADDITIONAL_INTAKE_QUESTIONS.data}
                values={payload.data}
                onChange={(key, value) => patch((p) => ({ ...p, data: { ...p.data, [key]: value } }))}
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Model &amp; vendor</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label="Build or buy"
                value={payload.modelVendor.buildOrBuy}
                options={BUILD_OR_BUY}
                onChange={(v) =>
                  patch((p) => ({ ...p, modelVendor: { ...p.modelVendor, buildOrBuy: v } }))
                }
              />
              <TextField
                label="Vendor name"
                maxLength={INTAKE_LIMITS.short}
                value={payload.modelVendor.vendorName ?? ""}
                onChange={(v) =>
                  patch((p) => ({
                    ...p,
                    modelVendor: { ...p.modelVendor, vendorName: v === "" ? null : v },
                  }))
                }
              />
              <SelectField
                label="Hosting"
                value={payload.modelVendor.hosting}
                options={HOSTING}
                onChange={(v) =>
                  patch((p) => ({ ...p, modelVendor: { ...p.modelVendor, hosting: v } }))
                }
              />
              <SelectField
                label="Model type"
                value={payload.modelVendor.modelType}
                options={MODEL_TYPES}
                onChange={(v) =>
                  patch((p) => ({ ...p, modelVendor: { ...p.modelVendor, modelType: v } }))
                }
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Population &amp; impact</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <LinesField
                label="Affected populations — one per line"
                values={payload.populationImpact.affectedPopulations}
                onChange={(entries) => {
                  patch((p) => ({
                    ...p,
                    populationImpact: { ...p.populationImpact, affectedPopulations: entries },
                  }));
                }}
              />
              <TextAreaField
                label="Expected benefits"
                maxLength={INTAKE_LIMITS.long}
                value={payload.populationImpact.expectedBenefits ?? ""}
                onChange={(v) =>
                  patch((p) => ({
                    ...p,
                    populationImpact: {
                      ...p.populationImpact,
                      expectedBenefits: v === "" ? null : v,
                    },
                  }))
                }
              />
              <TextAreaField
                label="Expected harms / risks"
                maxLength={INTAKE_LIMITS.long}
                value={payload.populationImpact.expectedHarms ?? ""}
                hint="Must be distinct from expected benefits."
                onChange={(v) =>
                  patch((p) => ({
                    ...p,
                    populationImpact: {
                      ...p.populationImpact,
                      expectedHarms: v === "" ? null : v,
                    },
                  }))
                }
              />
              <AdditionalQuestions
                questions={ADDITIONAL_INTAKE_QUESTIONS.populationImpact}
                values={payload.populationImpact}
                onChange={(key, value) => patch((p) => ({ ...p, populationImpact: { ...p.populationImpact, [key]: value } }))}
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Deployment</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <LinesField
                label="Integration points — one per line"
                values={payload.deployment.integrationPoints}
                onChange={(entries) => {
                  patch((p) => ({
                    ...p,
                    deployment: { ...p.deployment, integrationPoints: entries },
                  }));
                }}
              />
              <TextAreaField
                label="Rollout plan"
                maxLength={INTAKE_LIMITS.long}
                value={payload.deployment.rolloutPlan ?? ""}
                onChange={(v) =>
                  patch((p) => ({
                    ...p,
                    deployment: { ...p.deployment, rolloutPlan: v === "" ? null : v },
                  }))
                }
              />
              <AdditionalQuestions
                questions={ADDITIONAL_INTAKE_QUESTIONS.deployment}
                values={payload.deployment}
                onChange={(key, value) => patch((p) => ({ ...p, deployment: { ...p.deployment, [key]: value } }))}
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Overlay questions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {OVERLAY_QUESTIONS.map(({ key, question, helper }, index) => (
                <fieldset
                  key={key}
                  className="flex flex-col gap-1"
                  data-slot="overlay-question"
                  aria-describedby={gapIdsFor(`overlay.${key}`)?.join(" ") || undefined}
                >
                  <legend className="text-sm font-medium">
                    {index + 1}. <span>{question}</span>
                  </legend>
                  <span className="text-xs text-muted-foreground">{helper}</span>
                  <div className="flex gap-4 pt-0.5">
                    {[
                      { label: "Yes", value: true },
                      { label: "No", value: false },
                    ].map(({ label, value }) => (
                      <label key={label} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="radio"
                          name={`overlay-${key}`}
                          required
                          checked={payload.overlay[key] === value}
                          onChange={() =>
                            patch((p) => ({ ...p, overlay: { ...p.overlay, [key]: value } }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </CardContent>
          </Card>
        </fieldset>

        <div className="flex items-center gap-3">
          {session && isRequester ? (
            <>
              <Button
                type="button"
                variant="outline"
                aria-describedby={titleHintShown ? titleHintId : undefined}
                disabled={!unsaved || busy !== null || (!isPublic && payload.basics.title.trim() === "")}
                onClick={() => void handleSaveDraft()}
                data-slot="save-intake-draft"
              >
                {busy === "save" ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                disabled={!completeness.canSubmit || busy !== null}
                onClick={() => void handleSubmit()}
                data-slot="submit-intake"
              >
                {busy === "submit" ? "Submitting…" : "Submit intake"}
              </Button>
            </>
          ) : (
            <DisableWithTooltip label="Submit intake" requiresRole="requester" />
          )}
          {session && isRequester && !completeness.canSubmit ? (
            <span className="text-xs text-muted-foreground">
              Resolve the blocking gaps listed under Completeness to enable submission.
            </span>
          ) : null}
        </div>
        {titleHintShown ? (
          <p id={titleHintId} className="text-xs text-muted-foreground">Add an initiative title to save a draft.</p>
        ) : null}
        {/* Mounted at all times so screen readers announce a change of text. */}
        <p role="status" className="text-xs text-muted-foreground empty:sr-only" data-slot="intake-save-status">
          {status && !unsaved ? status : ""}
        </p>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card size="sm" data-slot="tier-preview">
          <CardHeader>
            <CardTitle className="text-sm">Live tier preview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {preview ? (
              <>
                <div className="flex items-center gap-2">
                  <TierBadge tier={preview.tier} />
                  <span className="text-xs text-muted-foreground">{preview.ruleText}</span>
                </div>
                <p className="text-xs font-medium">
                  {preview.requiredDomains.length} required domains
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.requiredDomains.map((domain) => (
                    <Badge key={domain} variant="outline">
                      {DOMAIN_LABEL[domain]}
                    </Badge>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Answer all six overlay questions to see the tier.
              </p>
            )}
          </CardContent>
        </Card>

        <Card size="sm" data-slot="completeness-meter" data-pristine={String(pristine)}>
          <CardHeader>
            <CardTitle className="text-sm">Completeness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={completeness.completenessPct}>
              <ProgressLabel>Evaluated rules passing</ProgressLabel>
              <ProgressValue />
            </Progress>
            <div aria-live="polite" className="space-y-3">
            {completeness.canSubmit ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Submission is not blocked — all blocking rules pass.
              </p>
            ) : pristine ? (
              <p className="text-xs text-muted-foreground">
                Still to complete before this can be submitted:
              </p>
            ) : (
              <p className="text-xs text-destructive">
                Blocking gaps must be resolved before submission.
              </p>
            )}
            {(["BLOCKING", "REQUIRED_FOR_TIER", "ADVISORY"] as const).map((level) => {
              const gaps = gapsByLevel(level);
              if (gaps.length === 0) return null;
              // Untouched: neutral styling. Nothing has failed yet — the
              // visitor simply has not started. The status colours return the
              // moment they engage.
              const levelClass = pristine ? "text-muted-foreground" : GAP_LEVEL_CLASS[level];
              return (
                <div key={level} className="space-y-1">
                  <p className={`text-xs font-medium uppercase ${levelClass}`}>
                    {pristine && level === "BLOCKING"
                      ? `Still to complete (${gaps.length})`
                      : `${GAP_LEVEL_LABEL[level]} (${gaps.length})`}
                  </p>
                  <ul className="space-y-1">
                    {gaps.map((gap) => (
                      <li
                        key={gap.ruleId}
                        id={`intake-gap-${gap.ruleId}`}
                        className={`text-xs ${levelClass}`}
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
            })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
