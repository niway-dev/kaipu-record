-- NIW2-219 added this index to the schema after the baseline was taken. Production may already
-- have it (if it was pushed with db:push when Google sign-in shipped) or not, so it is created
-- only when missing: the migration is correct either way.
CREATE UNIQUE INDEX IF NOT EXISTS "account_provider_account_uidx" ON "kaipu_record_account" USING btree ("provider_id","account_id");
