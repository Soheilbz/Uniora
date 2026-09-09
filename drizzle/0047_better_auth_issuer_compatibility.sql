-- Better Auth 1.7.3 restored the 1.6 account schema and no longer writes
-- account.issuer. Keep the historical column for data provenance, but relax
-- the 1.7.0-1.7.2 NOT NULL constraint and remove its obsolete unique index so
-- new credential and SSO account rows can be inserted by the current adapter.
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "account_issuer_id_idx";
