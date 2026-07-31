-- Fix absolute localhost (or any host) /api/media/... URLs left by local admin uploads.
-- Idempotent: safe to re-run. Applied via `npm run db:migrate`.
-- Also mirrored at the end of db/schema.sql for fresh `pnpm db:init` installs.

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
