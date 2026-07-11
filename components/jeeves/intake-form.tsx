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
 *   (the champion case submits WITH its RFT-02 retention gap by design).
 * - "Load champion example" populates the whole form from
 *   CHAMPION_PREFILL_PAYLOAD (intake-spec §4).
 * - Read-only public mode (no live session): fields render but are
 *   non-interactive (one <fieldset disabled> wrapper) and Submit is the
 *   standard disabled-with-tooltip gate (ui-spec §4 states / §8.4).
 * - Live mode: Submit runs create -> submit through the real API and
 *   routes to the new initiative's detail page.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { IntakePayload } from "@/lib/intake/types";
import {
  evaluateCompleteness,
  type CompletenessGap,
} from "@/lib/intake/completeness";
import { CHAMPION_PREFILL_PAYLOAD } from "@/lib/intake/champion-prefill";
import { previewTier } from "@/lib/client/tier-preview";
import {
  createInitiative,
  submitIntake,
  isApiError,
  apiErrorToMessage,
} from "@/lib/client/api";
import { rememberInitiative } from "@/lib/client/live-registry";
import { useLiveSession } from "@/lib/client/session-context";
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
const HOSTING = ["Vendor-hosted", "Self-hosted (Meridian infra)"] as const;
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

const EMPTY_PAYLOAD: IntakePayload = {
  basics: {
    title: "",
    sponsorOrg: "",
    requesterName: "",
    requesterEmail: "",
    businessProblem: "",
  },
  useCase: { primaryUsers: "", decisionInformed: "", expectedVolume: null },
  data: {
    dataSources: [],
    phiCategories: [],
    phiCategoriesOtherText: null,
    retentionIntent: null,
    retentionIntentNote: null,
    trainingVsInference: null,
  },
  modelVendor: { buildOrBuy: null, vendorName: null, hosting: null, modelType: null },
  populationImpact: { affectedPopulations: [], expectedBenefits: null, expectedHarms: null },
  deployment: { integrationPoints: [], rolloutPlan: null },
  overlay: {
    touchesPHI: null,
    memberFacing: null,
    careCoverageInfluence: null,
    vendorHosted: null,
    humanInTheLoop: null,
    individualImpact: null,
  },
  evidenceAttachments: [],
};

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} className={textareaClass} />
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
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
 * The form
 * ---------------------------------------------------------------------- */

export function IntakeForm() {
  const router = useRouter();
  const { session, logout } = useLiveSession();

  const [payload, setPayload] = React.useState<IntakePayload>(EMPTY_PAYLOAD);
  // Multi-entry (one per line) fields keep raw text state so typing
  // newlines works; the payload arrays are derived on every change.
  const [dataSourcesText, setDataSourcesText] = React.useState("");
  const [populationsText, setPopulationsText] = React.useState("");
  const [integrationsText, setIntegrationsText] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const patch = React.useCallback((update: (prev: IntakePayload) => IntakePayload) => {
    setPayload((prev) => update(prev));
  }, []);

  function splitLines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  function loadChampion() {
    setPayload(CHAMPION_PREFILL_PAYLOAD);
    setDataSourcesText(CHAMPION_PREFILL_PAYLOAD.data.dataSources.join("\n"));
    setPopulationsText(CHAMPION_PREFILL_PAYLOAD.populationImpact.affectedPopulations.join("\n"));
    setIntegrationsText(CHAMPION_PREFILL_PAYLOAD.deployment.integrationPoints.join("\n"));
  }

  const preview = previewTier(payload.overlay);
  const completeness = evaluateCompleteness(payload, preview?.tier);
  const gapsByLevel = (level: CompletenessGap["level"]) =>
    completeness.gaps.filter((g) => g.level === level);

  const isRequester = session?.role === "requester";

  async function handleSubmit() {
    if (!session) return;
    setSubmitting(true);
    try {
      const created = await createInitiative(session.token, payload);
      rememberInitiative(created.slug, created.initiativeId);
      const submitted = await submitIntake(session.token, created.initiativeId);
      if (submitted.submitted) {
        toast.success(
          `Intake submitted — completeness ${submitted.completenessPct}%. Running the governance flow from here.`,
        );
        router.push(`/initiatives/${created.slug}`);
      } else {
        // BLOCKING gaps server-side (should match the client meter, which
        // already gates submit — but the server stays the source of truth).
        toast.error(
          `Submission blocked: ${submitted.gaps.map((g) => g.message).join(" ")}`,
        );
      }
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
      setSubmitting(false);
    }
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      data-slot="intake-form"
    >
      <div className="flex flex-col gap-4">
        {!session ? (
          <Alert>
            <AlertTitle>Read-only mode</AlertTitle>
            <AlertDescription>
              Enter demo passcode to create a new initiative — the form below
              is visible but non-interactive until a live demo session is
              active (use the chip in the header).
            </AlertDescription>
          </Alert>
        ) : !isRequester ? (
          <Alert>
            <AlertTitle>Viewing as {session.personaLabel}</AlertTitle>
            <AlertDescription>
              You are viewing intake as {session.role} — only Requesters may
              create and submit new initiatives. Switch to a requester persona
              via the demo mode chip to submit.
            </AlertDescription>
          </Alert>
        ) : null}

        <div>
          <Button type="button" variant="outline" onClick={loadChampion} data-slot="load-champion">
            Load champion example
          </Button>
        </div>

        <fieldset
          disabled={!session}
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
                value={payload.basics.title}
                onChange={(v) => patch((p) => ({ ...p, basics: { ...p.basics, title: v } }))}
              />
              <TextField
                label="Sponsor organization"
                value={payload.basics.sponsorOrg}
                onChange={(v) => patch((p) => ({ ...p, basics: { ...p.basics, sponsorOrg: v } }))}
              />
              <TextField
                label="Requester name"
                value={payload.basics.requesterName}
                onChange={(v) =>
                  patch((p) => ({ ...p, basics: { ...p.basics, requesterName: v } }))
                }
              />
              <TextField
                label="Requester email"
                type="email"
                value={payload.basics.requesterEmail}
                onChange={(v) =>
                  patch((p) => ({ ...p, basics: { ...p.basics, requesterEmail: v } }))
                }
              />
              <div className="sm:col-span-2">
                <TextAreaField
                  label="Business problem"
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
                value={payload.useCase.primaryUsers}
                onChange={(v) =>
                  patch((p) => ({ ...p, useCase: { ...p.useCase, primaryUsers: v } }))
                }
              />
              <TextField
                label="Decision it informs"
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
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Data</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <TextAreaField
                label="Data source(s) — one per line"
                value={dataSourcesText}
                onChange={(v) => {
                  setDataSourcesText(v);
                  const entries = splitLines(v);
                  patch((p) => ({ ...p, data: { ...p.data, dataSources: entries } }));
                }}
              />
              <div className="flex flex-col gap-1 text-sm">
                <span className="font-medium">PHI categories touched</span>
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
                            },
                          }));
                        }}
                      />
                      {category}
                    </label>
                  ))}
                </div>
              </div>
              {payload.data.phiCategories.includes("Other") ? (
                <TextField
                  label="Other PHI category"
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
              <TextAreaField
                label="Affected populations — one per line"
                value={populationsText}
                onChange={(v) => {
                  setPopulationsText(v);
                  const entries = splitLines(v);
                  patch((p) => ({
                    ...p,
                    populationImpact: { ...p.populationImpact, affectedPopulations: entries },
                  }));
                }}
              />
              <TextAreaField
                label="Expected benefits"
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
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Deployment</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3">
              <TextAreaField
                label="Integration points — one per line"
                value={integrationsText}
                onChange={(v) => {
                  setIntegrationsText(v);
                  const entries = splitLines(v);
                  patch((p) => ({
                    ...p,
                    deployment: { ...p.deployment, integrationPoints: entries },
                  }));
                }}
              />
              <TextAreaField
                label="Rollout plan"
                value={payload.deployment.rolloutPlan ?? ""}
                onChange={(v) =>
                  patch((p) => ({
                    ...p,
                    deployment: { ...p.deployment, rolloutPlan: v === "" ? null : v },
                  }))
                }
              />
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm">Overlay questions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {OVERLAY_QUESTIONS.map(({ key, question, helper }, index) => (
                <div key={key} className="flex flex-col gap-1" data-slot="overlay-question">
                  <span className="text-sm font-medium">
                    {index + 1}. <span>{question}</span>
                  </span>
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
                          checked={payload.overlay[key] === value}
                          onChange={() =>
                            patch((p) => ({ ...p, overlay: { ...p.overlay, [key]: value } }))
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </fieldset>

        <div className="flex items-center gap-3">
          {session && isRequester ? (
            <Button
              type="button"
              disabled={!completeness.canSubmit || submitting}
              onClick={() => void handleSubmit()}
              data-slot="submit-intake"
            >
              {submitting ? "Submitting…" : "Submit intake"}
            </Button>
          ) : (
            <DisableWithTooltip label="Submit intake" requiresRole="requester" />
          )}
          {session && isRequester && !completeness.canSubmit ? (
            <span className="text-xs text-muted-foreground">
              Resolve the blocking gaps above to enable submission.
            </span>
          ) : null}
        </div>
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

        <Card size="sm" data-slot="completeness-meter">
          <CardHeader>
            <CardTitle className="text-sm">Completeness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={completeness.completenessPct}>
              <ProgressLabel>Evaluated rules passing</ProgressLabel>
              <ProgressValue />
            </Progress>
            {completeness.canSubmit ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                Submission is not blocked — all blocking rules pass.
              </p>
            ) : (
              <p className="text-xs text-destructive">
                Blocking gaps must be resolved before submission.
              </p>
            )}
            {(["BLOCKING", "REQUIRED_FOR_TIER", "ADVISORY"] as const).map((level) => {
              const gaps = gapsByLevel(level);
              if (gaps.length === 0) return null;
              return (
                <div key={level} className="space-y-1">
                  <p className={`text-xs font-medium uppercase ${GAP_LEVEL_CLASS[level]}`}>
                    {GAP_LEVEL_LABEL[level]} ({gaps.length})
                  </p>
                  <ul className="space-y-1">
                    {gaps.map((gap) => (
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
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
