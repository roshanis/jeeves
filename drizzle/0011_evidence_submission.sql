CREATE TABLE evidence_documents (
 id text PRIMARY KEY, initiative_id text NOT NULL REFERENCES initiatives(id), request_id text NOT NULL,
 file_name text NOT NULL, media_type text NOT NULL, byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
 sha256 text NOT NULL, content bytea NOT NULL, scan_status text NOT NULL DEFAULT 'not_scanned' CHECK (scan_status = 'not_scanned'),
 version integer NOT NULL CHECK (version > 0), supersedes_id text REFERENCES evidence_documents(id), uploaded_by text NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT evidence_documents_size CHECK (octet_length(content) = byte_size)
);
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_documents_request_uq ON evidence_documents(initiative_id, request_id);
--> statement-breakpoint
CREATE INDEX evidence_documents_initiative_idx ON evidence_documents(initiative_id);
--> statement-breakpoint
CREATE TABLE evidence_packets (
 id text PRIMARY KEY, initiative_id text NOT NULL REFERENCES initiatives(id), cycle_id text NOT NULL REFERENCES review_cycles(id),
 version integer NOT NULL CHECK(version > 0), revision integer NOT NULL CHECK(revision > 0), status text NOT NULL CHECK(status IN ('draft','submitted')),
 entries jsonb NOT NULL, submitted_by text, submitted_at timestamptz, created_at timestamptz NOT NULL,
 CONSTRAINT evidence_packets_submission CHECK ((status='draft' AND submitted_at IS NULL AND submitted_by IS NULL) OR (status='submitted' AND submitted_at IS NOT NULL AND submitted_by IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_packets_version_uq ON evidence_packets(cycle_id,version);
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_packets_draft_uq ON evidence_packets(cycle_id) WHERE status='draft';
--> statement-breakpoint
CREATE INDEX evidence_packets_initiative_idx ON evidence_packets(initiative_id);
--> statement-breakpoint
CREATE TABLE evidence_assessments (
 id text PRIMARY KEY, packet_id text NOT NULL REFERENCES evidence_packets(id), control_id text NOT NULL REFERENCES control_definitions(id),
 decision text NOT NULL CHECK(decision IN ('accepted','changes_requested')), reason text NOT NULL CHECK(length(trim(reason)) > 0), reviewer text NOT NULL, reviewed_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX evidence_assessments_control_uq ON evidence_assessments(packet_id,control_id);
--> statement-breakpoint
CREATE FUNCTION evidence_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'evidence record is immutable'; END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER evidence_documents_immutable BEFORE UPDATE OR DELETE ON evidence_documents FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
--> statement-breakpoint
CREATE TRIGGER evidence_assessments_immutable BEFORE UPDATE OR DELETE ON evidence_assessments FOR EACH ROW EXECUTE FUNCTION evidence_immutable();
--> statement-breakpoint
CREATE FUNCTION evidence_packet_immutable() RETURNS trigger AS $$
BEGIN
 IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'submitted evidence packet is immutable'; END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER evidence_packets_immutable BEFORE UPDATE OR DELETE ON evidence_packets FOR EACH ROW EXECUTE FUNCTION evidence_packet_immutable();
