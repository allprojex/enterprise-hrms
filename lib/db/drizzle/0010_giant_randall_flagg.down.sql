-- Rollback for 0010_giant_randall_flagg.sql (Forgot Password Email Delivery:
-- adds password_reset_token/password_reset_token_expires_at to `users`).
-- Purely additive in the up direction -- no existing column or row was
-- touched -- so this rollback only drops what it created.

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_password_reset_token_unique";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_reset_token_expires_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "password_reset_token";
