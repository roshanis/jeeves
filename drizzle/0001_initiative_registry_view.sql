-- Hand-written migration (not drizzle-kit generated).
--
-- plan.md §5: "Registry = a SQL view over authoritative records." This view
-- is a read-only projection over initiatives + their latest risk assessment
-- + latest deployment version + accountable approver from the most recent
-- initiative_decisions row. It is never written to directly — all writes
-- happen against the authoritative tables above, and the view always
-- reflects their current state.
CREATE VIEW "initiative_registry" AS
SELECT
	i."id" AS "initiative_id",
	i."slug",
	i."title",
	i."requester",
	i."state",
	i."tier",
	i."accountable_approver",
	ra."id" AS "latest_risk_assessment_id",
	ra."version" AS "latest_risk_assessment_version",
	ra."required_domains" AS "latest_required_domains",
	dv."id" AS "latest_deployment_id",
	dv."version" AS "latest_deployment_version",
	dv."status" AS "latest_deployment_status",
	i."created_at",
	i."updated_at"
FROM "initiatives" i
LEFT JOIN LATERAL (
	SELECT *
	FROM "risk_assessments" r
	WHERE r."initiative_id" = i."id"
	ORDER BY r."version" DESC
	LIMIT 1
) ra ON true
LEFT JOIN LATERAL (
	SELECT *
	FROM "deployment_versions" d
	WHERE d."initiative_id" = i."id"
	ORDER BY d."deployed_at" DESC
	LIMIT 1
) dv ON true;
--> statement-breakpoint
