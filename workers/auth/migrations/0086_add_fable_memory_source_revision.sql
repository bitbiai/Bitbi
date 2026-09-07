-- Bind newly produced memory to the effective transcript revision actually read.
-- NULL deliberately leaves pre-Q4 checkpoints unproven: retain their summaries,
-- usage and provider evidence, but Q4 must use bounded raw context instead.
-- Appended turns do not change admin_revision_version. Prefix-affecting edits,
-- deletion and restoration are recorded atomically in the existing mutation ledger.
ALTER TABLE fable_chat_memory_checkpoints
  ADD COLUMN source_admin_revision_version INTEGER
  CHECK (source_admin_revision_version IS NULL OR source_admin_revision_version >= 0);

-- A claimed source identity is immutable, including the legacy NULL state.
CREATE TRIGGER fable_chat_memory_source_revision_immutable
BEFORE UPDATE OF source_admin_revision_version ON fable_chat_memory_checkpoints
WHEN NEW.source_admin_revision_version IS NOT OLD.source_admin_revision_version
BEGIN
  SELECT RAISE(ABORT, 'Memory source revision is immutable');
END;
