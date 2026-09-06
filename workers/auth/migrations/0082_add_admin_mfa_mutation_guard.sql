-- A per-operation CAS marker binds MFA consumption and credential/recovery
-- rotation to one atomic batch. Existing populated rows begin with NULL.
ALTER TABLE admin_mfa_credentials ADD COLUMN mutation_token TEXT;
