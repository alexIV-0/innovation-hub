-- История получателей диалога «Поделиться»: кого этот человек уже приглашал.
--
-- Хранится у пользователя, а не у проекта: список нужен один и тот же, откуда
-- бы диалог ни открыли — из «Проектов» или из «Папок пользователей» в админке.
-- Владелец списка — тот, кто нажал «Отправить» (админ, раздающий чужой проект,
-- копит свою историю, а не владельца проекта).
--
-- Ключ — почта, а не user_id: приглашение адресуется адресу, аккаунт под ним
-- заводится уже роутом. Имя лежит рядом снимком на момент приглашения — в
-- выпадающем списке подписывать строку одним адресом нечитаемо, а тянуть JOIN
-- к users ради подписи незачем: имя обновляется при следующем приглашении.
CREATE TABLE IF NOT EXISTS share_contacts (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  full_name    TEXT NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, email)
);

-- Список читается только «свежие сверху» и только по одному владельцу.
CREATE INDEX IF NOT EXISTS share_contacts_recent_idx
  ON share_contacts (user_id, last_used_at DESC);
