-- Fix absolute localhost (or any host) /api/media/... URLs left by local admin uploads.
-- Idempotent: safe to re-run. Also included at the end of db/schema.sql for `pnpm db:init`.
--
-- Usage (prod):
--   psql "$DB_CONNECTION_STRING" -f db/migrations/2026-07-27-fix-absolute-media-urls.sql

BEGIN;

UPDATE videos
SET thumbnail = regexp_replace(thumbnail, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/api/media/';

UPDATE videos
SET video_url = regexp_replace(video_url, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/api/media/';

UPDATE ideas
SET thumbnail = regexp_replace(thumbnail, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/api/media/';

UPDATE ideas
SET video_url = regexp_replace(video_url, '^https?://[^/]+(/api/media/.*)$', '\1'),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/api/media/';

COMMIT;
