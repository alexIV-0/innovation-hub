-- Сейф: внешние сервисы, их ключи, прайс и учёт потребления.
-- Разбор и обоснования — docs/VENDOR_SERVICES_PLAN.md.
--
-- Миграция ничего не включает: таблицы появляются пустыми, конвейер их не
-- спрашивает, поведение сайта не меняется. Сервис заводится руками в админке, и
-- до первой записи ничего не происходит.
--
-- ⚠️ Шифрование требует `VAULT_MASTER_KEY` в окружении. Без него сервис нельзя
-- создать — сайт откажется писать секрет, который не сможет прочитать.

-- ── Сервисы ─────────────────────────────────────────────────────────────────
--
-- Каждый сервис заводится отдельно: у каждого своя пара «как авторизоваться» и
-- «как считать цену». Общего у них ровно столько, сколько здесь перечислено.
CREATE TABLE IF NOT EXISTS vendor_services (
  id           TEXT PRIMARY KEY,
  -- По слагу машина просит ключ: он стабилен, а имя правят.
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  -- Какой код умеет разговаривать с этим сервисом. Пока справочное поле:
  -- адаптеры живут в программе, сайт только хранит и считает.
  adapter      TEXT NOT NULL DEFAULT '',

  -- Как платим вендору. Влияет на то, чему верить при сверке (С6): у
  -- предоплаты есть остаток, у постоплаты — счёт, у подписки нет ни того ни
  -- другого.
  billing_model TEXT NOT NULL DEFAULT 'prepaid'
                 CHECK (billing_model IN ('prepaid', 'postpaid', 'subscription')),

  -- Валюта ПРАЙСА этого сервиса, не кошелька. Кошелёк рублёвый всегда
  -- (lib/billing/types.ts#ACCOUNT_CURRENCY), а вендор выставляет счёт в своей.
  currency     TEXT NOT NULL DEFAULT 'USD',

  -- Как ключ попадает к исполнителю (С4). По умолчанию `keys`: ключ едет на
  -- машину, вендора нода зовёт сама. `proxy` — редкий случай, когда ключ не
  -- выпускается с сервера ни при каких условиях.
  delivery     TEXT NOT NULL DEFAULT 'keys'
                 CHECK (delivery IN ('keys', 'proxy')),

  -- Сколько живёт копия ключа в сейфе на машине. Не «навсегда» именно потому,
  -- что возможность отозвать — единственное, ради чего ключи переехали на сайт.
  key_ttl_sec  INTEGER NOT NULL DEFAULT 21600 CHECK (key_ttl_sec BETWEEN 60 AND 604800),

  -- Дневной потолок расхода. 0 — без потолка. Страховка от зацикленного графа
  -- и от утёкшего ключа: и то и другое проявляется одинаково — счётчик растёт.
  daily_cap_cents BIGINT NOT NULL DEFAULT 0 CHECK (daily_cap_cents >= 0),

  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'paused', 'revoked')),

  -- Чей секрет. NULL = платформенный: ключ наш, и работает он у всех.
  -- Заполненный владелец — тот же сейф для аккаунтов площадок конкретного
  -- человека (SOCIAL_POSTING_PLAN §4). Колонка нужна с первого дня: свести
  -- позже два хранилища значило бы завести две процедуры отзыва.
  owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,

  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_services_owner_idx
  ON vendor_services (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- ── Секреты ─────────────────────────────────────────────────────────────────
--
-- Версия, а не поле: ротация добавляет строку, старая живёт до отзыва. Иначе
-- задачи, которые уже держат прежний ключ, упали бы в момент ротации.
--
-- Шифротекст — AES-256-GCM мастер-ключом из окружения (lib/vault/crypto.ts).
-- В базе только он: дамп базы сам по себе тогда не утечка ключей, а дампы
-- делаются и уезжают.
CREATE TABLE IF NOT EXISTS vendor_service_secrets (
  id           TEXT PRIMARY KEY,
  service_id   TEXT NOT NULL REFERENCES vendor_services(id) ON DELETE CASCADE,
  version      INTEGER NOT NULL CHECK (version > 0),
  ciphertext   TEXT NOT NULL,
  -- «••••4f21»: узнать глазами, какой ключ лежит, не доставая его.
  hint         TEXT NOT NULL DEFAULT '',
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ,
  UNIQUE (service_id, version)
);

-- Живых версий может быть несколько — на время ротации это норма. Машина
-- получает старшую живую.
CREATE INDEX IF NOT EXISTS vendor_service_secrets_live_idx
  ON vendor_service_secrets (service_id, version DESC) WHERE revoked_at IS NULL;

-- ── Прайс ───────────────────────────────────────────────────────────────────
--
-- Отдельная таблица с датой, а не поле: цены вендоров меняются, а прошлые
-- списания пересчитываться не должны. Тот же принцип, по которому применённый
-- курс уезжает в транзакцию и там застывает.
--
-- Цена в МИКРОединицах валюты: токен за $0.000002 в центах округлился бы в
-- ноль, и потребление стало бы бесплатным. Тот же случай, что BYTES_PER_UNIT.
CREATE TABLE IF NOT EXISTS vendor_service_prices (
  id             TEXT PRIMARY KEY,
  service_id     TEXT NOT NULL REFERENCES vendor_services(id) ON DELETE CASCADE,
  unit           TEXT NOT NULL CHECK (unit IN ('token', 'char', 'sec', 'image', 'run')),
  price_micros   BIGINT NOT NULL CHECK (price_micros >= 0),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS vendor_service_prices_lookup_idx
  ON vendor_service_prices (service_id, unit, effective_from DESC);

-- ── Потребление ─────────────────────────────────────────────────────────────
--
-- Строка на «сервис × мера» в рамках одной задачи. Появляется из отчёта ноды,
-- в котором ЕДИНИЦЫ, а не деньги: деньги считает сайт по прайсу выше (С4).
--
-- Одна обработка может звать несколько сервисов, и `total_cost` одним числом
-- это скрывал. Здесь же разрез «сколько мы потратили у кого» — обычный запрос.
CREATE TABLE IF NOT EXISTS vendor_usage (
  id           TEXT PRIMARY KEY,
  -- = tasks.id = processing_stats.item_id. Без внешнего ключа намеренно, как у
  -- billing_transactions: задачи чистятся, расход остаётся.
  task_id      TEXT NOT NULL,
  service_id   TEXT REFERENCES vendor_services(id) ON DELETE SET NULL,
  project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,

  unit         TEXT NOT NULL,
  units        NUMERIC(18, 4) NOT NULL CHECK (units > 0),

  -- ПРИМЕНЁННЫЕ значения, а не ссылки на текущие: правка прайса или курса не
  -- должна переписывать прошлые обработки.
  price_micros BIGINT NOT NULL CHECK (price_micros >= 0),
  currency     TEXT NOT NULL,
  fx_rate      NUMERIC(18, 6),
  fx_source    TEXT,
  -- Итог в копейках рублей: единицы × цена × курс. Себестоимость, без наценки.
  cents        BIGINT NOT NULL CHECK (cents >= 0),

  -- Кто сообщил. Нужно, чтобы при расхождении в сверке было видно, с какой
  -- машины пришли странные числа.
  computer_id  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Повторный отчёт по той же задаче не удваивает расход. Держит база, а не код:
-- taskDone переигрывается, и машина имеет право прислать отчёт дважды.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_usage_once_idx
  ON vendor_usage (task_id, service_id, unit);

CREATE INDEX IF NOT EXISTS vendor_usage_task_idx ON vendor_usage (task_id);
CREATE INDEX IF NOT EXISTS vendor_usage_service_idx
  ON vendor_usage (service_id, created_at DESC);

-- ── Ревизия сейфа ───────────────────────────────────────────────────────────
--
-- Одно число, растущее на любую правку секретов. Машина получает его в ответе
-- на heartbeat и сравнивает со своим: разошлось — идёт за ключами. Так отзыв
-- доезжает за полминуты, а не по истечении TTL.
--
-- Синглтон-строка по образцу automation_settings (docs/SETTINGS_SYNC.md §6):
-- это счётчик версии, а не хеш, и растёт он на каждую запись.
CREATE TABLE IF NOT EXISTS vendor_vault_state (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  revision   BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vendor_vault_state_singleton_chk CHECK (id = 'singleton')
);

INSERT INTO vendor_vault_state (id) VALUES ('singleton')
    ON CONFLICT (id) DO NOTHING;
