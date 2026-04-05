-- Add status column to ai_folders for safe concurrent deletion
-- Migration 0009

ALTER TABLE ai_folders ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
