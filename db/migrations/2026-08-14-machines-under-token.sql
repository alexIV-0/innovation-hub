-- Машины, подключённые по одному токену: привязка и два признака активности.
--
-- Модель `mch_`-токена — «один токен, много машин»: у пользователя один токен, и
-- под ним может работать сколько угодно машин, каждая со своим UUID. Раньше
-- самозаписанная машина не помнила, каким токеном пришла, поэтому вопрос «какие
-- машины подключены по этому токену» был неотвечаем.
--
-- `rc_`-компьютеры остаются как были: там токен свой у каждого, привязка не нужна,
-- и в этой колонке у них NULL.

ALTER TABLE remote_computers
  ADD COLUMN IF NOT EXISTS registered_token_id TEXT
    REFERENCES machine_tokens(id) ON DELETE CASCADE;

-- CASCADE осознанно: удалили токен — машины под ним теряют смысл, они
-- существовали только как «кто ходил этим токеном». Отзыв токена (revoked_at)
-- строку не удаляет, поэтому машины гасятся отдельно, в коде отзыва.

CREATE INDEX IF NOT EXISTS remote_computers_token_idx
  ON remote_computers (registered_token_id)
  WHERE registered_token_id IS NOT NULL AND revoked_at IS NULL;

-- Два разных признака, и их нельзя сводить в один.
--
-- last_seen_at — машина вообще на связи: любое обращение к сайту со своим UUID.
-- last_claim_at — на машине запущен воркер и он опрашивает очередь.
--
-- Различие практическое: машина может быть включена и синхронизировать файлы, но
-- обработку не вести. Один признак на оба состояния показывал бы «не подключена»
-- у живой машины с выключенным воркером.
ALTER TABLE remote_computers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE remote_computers ADD COLUMN IF NOT EXISTS last_claim_at TIMESTAMPTZ;

-- Первое заполнение: у уже существующих машин единственный след контакта — это
-- heartbeat, так что берём его, чтобы строки не выглядели «никогда не выходившими
-- на связь».
UPDATE remote_computers
   SET last_seen_at = last_heartbeat_at
 WHERE last_seen_at IS NULL AND last_heartbeat_at IS NOT NULL;
