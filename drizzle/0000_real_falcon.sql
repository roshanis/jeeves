CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text,
	"ts" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"before" text,
	"after" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "control_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"applicability" text NOT NULL,
	"policy_source" text,
	"owner" text NOT NULL,
	"required_evidence" text NOT NULL,
	"cadence" text NOT NULL,
	"enforcement_mode" text NOT NULL,
	"exception_process" text,
	"remediation_owner" text,
	"observation_kind" text,
	"tier_default_thresholds" jsonb,
	"sustained_window" integer
);
--> statement-breakpoint
CREATE TABLE "deployment_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"model_version" text,
	"self_hosted" boolean DEFAULT false NOT NULL,
	"feedback_provenance_signed_off" boolean DEFAULT false NOT NULL,
	"deployed_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "effective_controls" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"control_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"threshold_override" double precision,
	"evidence" text,
	"evidence_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"remediation_owner" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"control_id" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"identity_key" text NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"review_cycle_id" text,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_identity_key_unique" UNIQUE("identity_key")
);
--> statement-breakpoint
CREATE TABLE "initiative_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL,
	"cycle_id" text NOT NULL,
	"type" text NOT NULL,
	"approver" text NOT NULL,
	"policy_id" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decided_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"requester" text NOT NULL,
	"state" text NOT NULL,
	"tier" text,
	"accountable_approver" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "initiatives_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "intake_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL,
	"version" integer NOT NULL,
	"submitted" boolean DEFAULT false NOT NULL,
	"fields" jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"kind" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"value" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL,
	"kind" text NOT NULL,
	"risk_assessment_id" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"incident_id" text
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"cycle_id" text NOT NULL,
	"domain" text NOT NULL,
	"status" text NOT NULL,
	"reviewer" text,
	"draft_md" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signed_at" timestamp with time zone,
	"return_reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" text PRIMARY KEY NOT NULL,
	"initiative_id" text NOT NULL,
	"version" integer NOT NULL,
	"intake_version_id" text NOT NULL,
	"tier" text NOT NULL,
	"flags" jsonb NOT NULL,
	"required_domains" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_budget" (
	"id" text PRIMARY KEY NOT NULL,
	"day" text NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"tokens_cap" integer NOT NULL,
	CONSTRAINT "run_budget_day_unique" UNIQUE("day")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_versions" ADD CONSTRAINT "deployment_versions_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_controls" ADD CONSTRAINT "effective_controls_deployment_id_deployment_versions_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_controls" ADD CONSTRAINT "effective_controls_control_id_control_definitions_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."control_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_deployment_id_deployment_versions_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_control_id_control_definitions_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."control_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_decisions" ADD CONSTRAINT "initiative_decisions_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_decisions" ADD CONSTRAINT "initiative_decisions_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_versions" ADD CONSTRAINT "intake_versions_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_deployment_id_deployment_versions_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployment_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_cycles" ADD CONSTRAINT "review_cycles_risk_assessment_id_risk_assessments_id_fk" FOREIGN KEY ("risk_assessment_id") REFERENCES "public"."risk_assessments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_cycle_id_review_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."review_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_intake_version_id_intake_versions_id_fk" FOREIGN KEY ("intake_version_id") REFERENCES "public"."intake_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "effective_controls_deployment_control_version_uq" ON "effective_controls" USING btree ("deployment_id","control_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_deployment_control_window_uq" ON "incidents" USING btree ("deployment_id","control_id","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "intake_versions_initiative_version_uq" ON "intake_versions" USING btree ("initiative_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "review_decisions_cycle_domain_uq" ON "review_decisions" USING btree ("cycle_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_assessments_initiative_version_uq" ON "risk_assessments" USING btree ("initiative_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "run_budget_day_uq" ON "run_budget" USING btree ("day");