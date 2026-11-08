-- Independent Model Intelligence runtime activation format 1.
-- An operator applies this only after the imported source has been accepted.
CREATE TABLE "agentos_model_intelligence"._runtime_activation (
  singleton integer PRIMARY KEY CHECK(singleton=1),
  destination_id uuid NOT NULL,
  activation_id uuid NOT NULL,
  manifest_sha256 text COLLATE "C" NOT NULL,
  ddl_sha256 text COLLATE "C" NOT NULL,
  acceptance_ref text COLLATE "C" NOT NULL,
  active boolean NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE "agentos_model_intelligence"._runtime_activation FROM PUBLIC;
