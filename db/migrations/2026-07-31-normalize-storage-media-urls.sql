-- Rewrite absolute object-storage URLs (TWC / path-style S3 / etc.) to same-origin
-- /api/media/{key} paths. Path-style URLs look like:
--   https://storage…/bucket/innohub/file.png  →  /api/media/innohub/file.png
-- Idempotent: safe to re-run.

UPDATE videos
SET thumbnail = regexp_replace(
      thumbnail,
      '^https?://[^/]+/[^/]+/(innohub|ffworks)/(.+)$',
      '/api/media/\1/\2'
    ),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/[^/]+/(innohub|ffworks)/';

UPDATE videos
SET video_url = regexp_replace(
      video_url,
      '^https?://[^/]+/[^/]+/(innohub|ffworks)/(.+)$',
      '/api/media/\1/\2'
    ),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/[^/]+/(innohub|ffworks)/';

UPDATE ideas
SET thumbnail = regexp_replace(
      thumbnail,
      '^https?://[^/]+/[^/]+/(innohub|ffworks)/(.+)$',
      '/api/media/\1/\2'
    ),
    updated_at = NOW()
WHERE thumbnail ~ '^https?://[^/]+/[^/]+/(innohub|ffworks)/';

UPDATE ideas
SET video_url = regexp_replace(
      video_url,
      '^https?://[^/]+/[^/]+/(innohub|ffworks)/(.+)$',
      '/api/media/\1/\2'
    ),
    updated_at = NOW()
WHERE video_url ~ '^https?://[^/]+/[^/]+/(innohub|ffworks)/';

-- Objects live under innohub/ in the current bucket; rewrite mistaken
-- /api/media/ffworks/... keys written when AWS_S3_PREFIX was set to the
-- bucket name by accident.
UPDATE videos
SET thumbnail = replace(thumbnail, '/api/media/ffworks/', '/api/media/innohub/'),
    video_url = replace(video_url, '/api/media/ffworks/', '/api/media/innohub/'),
    updated_at = NOW()
WHERE thumbnail LIKE '%/api/media/ffworks/%'
   OR video_url LIKE '%/api/media/ffworks/%';

UPDATE ideas
SET thumbnail = replace(thumbnail, '/api/media/ffworks/', '/api/media/innohub/'),
    video_url = replace(video_url, '/api/media/ffworks/', '/api/media/innohub/'),
    updated_at = NOW()
WHERE thumbnail LIKE '%/api/media/ffworks/%'
   OR video_url LIKE '%/api/media/ffworks/%';
