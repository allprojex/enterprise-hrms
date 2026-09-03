ALTER TABLE "organizations" ADD COLUMN "tenant_uuid" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_tenant_uuid_unique" ON "organizations" USING btree ("tenant_uuid");--> statement-breakpoint
-- Tenant identity hardening (pre-production, 2026-09-03). Hand-authored
-- addition to the generated statements above: drizzle-kit does not model
-- triggers. `organizations.id` is the security boundary every tenant-owned
-- table references, and `organizations.tenant_uuid` is the immutable
-- external tenant identity. Neither may ever change once a row exists, so
-- the database refuses any UPDATE that alters either — this is enforcement,
-- not convention. Display name, slug, status and every other column remain
-- updatable through their existing, audited paths.
CREATE OR REPLACE FUNCTION organizations_identity_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_uuid IS DISTINCT FROM OLD.tenant_uuid THEN
    RAISE EXCEPTION 'organizations.id and organizations.tenant_uuid are immutable tenant identity (organization %)', OLD.id
      USING ERRCODE = 'check_violation',
            HINT = 'Tenant identity cannot be reassigned. Change the display name through the organization API instead.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER organizations_identity_immutable
  BEFORE UPDATE ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_identity_immutable();
