-- Учётки под сервисом (VENDOR_KEYS_CLIENT_REQUESTS, пункт 1).
--
-- До сих пор `vendor_service_secrets` хранил ВЕРСИИ ОДНОГО секрета — это
-- ротация ключа, а не разные ключи. Требование пришло с двух независимых
-- сторон сразу, и обе решаются одной колонкой владельца:
--
--   • тест и прод. Завести `11labs-test` отдельным сервисом нельзя — это два
--     прайса на один ElevenLabs, они разъедутся при первом изменении цен:
--     обновят один, забудут второй, и себестоимость тестов начнёт врать молча;
--   • клиент приносит свой ключ. Тогда расход не наш и в себестоимость ролика
--     попадать не должен — но и потерять его нельзя, иначе не видно, что у
--     клиента кончились деньги.
--
-- Прайс остаётся у СЕРВИСА: цена вендора не зависит от того, чьим ключом
-- позвали.

-- ── Учётки ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendor_accounts (
  id            TEXT PRIMARY KEY,
  service_id    TEXT NOT NULL REFERENCES vendor_services(id) ON DELETE CASCADE,

  -- Человекочитаемая метка: «main», «test», «ключ Иванова». Именно она уезжает
  -- в options.json проекта — не секрет и не id. Поэтому же она уникальна
  -- внутри сервиса: две «test» сделали бы ссылку из проекта двусмысленной.
  label         TEXT NOT NULL,

  -- Чья учётка. NULL = наша, платформенная: расход наш и идёт в себестоимость.
  -- Заполненный владелец — клиент принёс свой ключ, и его расход в цену ролика
  -- попадать не должен.
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,

  status        TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'revoked')),

  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (service_id, label)
);

CREATE INDEX IF NOT EXISTS vendor_accounts_owner_idx
  ON vendor_accounts (owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS vendor_accounts_service_idx
  ON vendor_accounts (service_id);

-- ── Секреты учёток ──────────────────────────────────────────────────────────
--
-- Версия, а не поле — та же причина, что была у секретов сервиса: ротация
-- добавляет строку, старая живёт до отзыва, иначе задачи в полёте упали бы в
-- момент ротации.
--
-- В `ciphertext` лежит JSON-ОБЪЕКТ полей, зашифрованный целиком, а не одна
-- строка ключа: у вендоров бывает пара `client_id` + `client_secret`, бывает
-- `login` + `password`. Хранить их одной строкой значило бы разбирать её
-- разделителем, а разделитель однажды встретится внутри пароля.
CREATE TABLE IF NOT EXISTS vendor_account_secrets (
  id          TEXT PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL CHECK (version > 0),
  ciphertext  TEXT NOT NULL,
  -- «••••4f21» по главному полю: узнать глазами, какой ключ лежит.
  hint        TEXT NOT NULL DEFAULT '',
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at  TIMESTAMPTZ,
  UNIQUE (account_id, version)
);

CREATE INDEX IF NOT EXISTS vendor_account_secrets_live_idx
  ON vendor_account_secrets (account_id, version DESC) WHERE revoked_at IS NULL;

-- ── Описание полей секрета у сервиса (пункт 2 запроса) ──────────────────────
--
-- Что спрашивать у человека при заведении учётки: `apiKey`, или `login` +
-- `password`, или `client_id` + `client_secret`. Тогда форма добавления учётки
-- одна на все сервисы и рисуется по данным, а не по коду: новый вендор — это
-- строка в каталоге, а не новое окно и пересборка программы с обеих сторон.
--
-- Пустой массив означает одно поле `apiKey` по умолчанию — так ведёт себя
-- код, и заводить ради этого запись в каждом сервисе незачем.
ALTER TABLE vendor_services
  ADD COLUMN IF NOT EXISTS secret_fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Чьим ключом позвали ─────────────────────────────────────────────────────
--
-- Снимает вопрос «чей расход» без участия ноды: учётку выдали мы, владельца
-- знаем мы. Ноде помечать ничего не надо (пункт 3 запроса).
--
-- ON DELETE SET NULL, как и у service_id: учётки отзывают, расход остаётся.
ALTER TABLE vendor_usage
  ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES vendor_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS vendor_usage_account_idx
  ON vendor_usage (account_id) WHERE account_id IS NOT NULL;

-- ── Перенос прежних секретов ────────────────────────────────────────────────
--
-- У каждого сервиса, где ключ уже был, появляется учётка «main» с той же
-- историей версий. Id детерминированные, а не случайные: на этой базе UUID
-- генерирует Node, gen_random_uuid() есть не во всех версиях Postgres, и
-- заодно повтор миграции становится безвредным (тот же приём, что в
-- 2026-08-27-billing.sql).
--
-- Прежний ciphertext — это одна строка ключа, а новый формат ждёт JSON-объект.
-- Не перешифровываем: мастер-ключ здесь недоступен. Вместо этого читатель
-- умеет оба формата — строка понимается как `{"apiKey": <строка>}`
-- (lib/vault/crypto.ts). Перешифровка случится сама при первой ротации.
INSERT INTO vendor_accounts (id, service_id, label, created_by, created_at)
SELECT 'acc-' || s.id, s.id, 'main', s.created_by, s.created_at
  FROM vendor_services s
 WHERE EXISTS (
         SELECT 1 FROM vendor_service_secrets sec WHERE sec.service_id = s.id
       )
    ON CONFLICT (id) DO NOTHING;

INSERT INTO vendor_account_secrets (
  id, account_id, version, ciphertext, hint, created_by, created_at, revoked_at
)
SELECT 'accsec-' || sec.id, 'acc-' || sec.service_id, sec.version,
       sec.ciphertext, sec.hint, sec.created_by, sec.created_at, sec.revoked_at
  FROM vendor_service_secrets sec
    ON CONFLICT (id) DO NOTHING;

-- `vendor_service_secrets` НЕ удаляем. Код её больше не читает, но снести
-- таблицу с шифротекстом в той же миграции, что переносит его, — значит
-- лишиться отката, если перенос где-то ошибся. Удалим отдельной миграцией,
-- когда новый путь отработает на живых ключах.
