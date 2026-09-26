-- Existing rows remain explicitly unverified; no historical signer/source truth is invented.
ALTER TABLE review_decisions
  ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  ADD COLUMN active_attempt_id text,
  ADD COLUMN active_attempt_expires_at timestamptz,
  ADD COLUMN signature_event_id text,
  ADD COLUMN missing_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN evidence_requests jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN source_metadata jsonb,
  ADD COLUMN citation_provenance text NOT NULL DEFAULT 'legacy-unverified';
