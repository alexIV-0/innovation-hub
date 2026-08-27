-- Биллинг: два кошелька, лента транзакций, подарки, курсы валют.
-- Разбор и обоснования — docs/BILLING_AND_TRIAL_PLAN.md.
--
-- Миграция ничего не включает: таблицы появляются пустыми, конвейер денег не
-- проверяет, поведение сайта не меняется. Гейт добавляется отдельно (П13), и у
-- него есть свой рубильник в настройках.

-- ── Курсы валют (В2) ────────────────────────────────────────────────────────
--
-- История, а не одно поле: применённый курс уезжает в транзакцию, но проверить
-- прошлое списание можно только по ряду. Источник тянем с ЦБ раз в сутки; при
-- недоступности берём последний известный, поэтому важна дата, а не «сейчас».
CREATE TABLE IF NOT EXISTS currency_rates (
  currency   TEXT NOT NULL,
  rate_day   DATE NOT NULL,
  -- Сколько рублей за единицу валюты.
  rate       NUMERIC(18, 6) NOT NULL CHECK (rate > 0),
  source     TEXT NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (currency, rate_day)
);

-- ── Подарки (П7, П8) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS billing_grants (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- trial — самообслуживание по кнопке, один раз; targeted — распоряжение админа.
  kind         TEXT NOT NULL CHECK (kind IN ('trial', 'targeted')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status       TEXT NOT NULL DEFAULT 'provisioning'
                 CHECK (status IN ('provisioning','active','exhausted','expired','revoked')),
  -- NULL = бессрочно. Срок живёт в самом гранте, а не в настройке: настройка
  -- меняется, выданный подарок — нет.
  expires_at   TIMESTAMPTZ,
  granted_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment      TEXT NOT NULL DEFAULT '',
  -- Работа, копирующая шаблоны (storage_jobs). Только у trial.
  provision_job_id TEXT,
  closed_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- «Один тестовый период на человека» держит база, а не код: строка переживает
-- удаление проектов, архив и корзину. Адресных подарков может быть сколько угодно.
CREATE UNIQUE INDEX IF NOT EXISTS billing_grants_trial_once_idx
  ON billing_grants (user_id) WHERE kind = 'trial';

CREATE INDEX IF NOT EXISTS billing_grants_user_idx
  ON billing_grants (user_id, created_at DESC);

-- Проекты, в которых действует подарок. ПУСТОЙ список = в любом проекте
-- владельца. Не флаг «пробный» у проекта: флаг ответил бы «пробный ли», а связь
-- отвечает ещё и «какого подарка» — и переживает вторую выдачу.
CREATE TABLE IF NOT EXISTS billing_grant_projects (
  grant_id   TEXT NOT NULL REFERENCES billing_grants(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (grant_id, project_id)
);

CREATE INDEX IF NOT EXISTS billing_grant_projects_project_idx
  ON billing_grant_projects (project_id);

-- ── Лента транзакций (П2) ───────────────────────────────────────────────────
--
-- Только СОСТОЯВШИЕСЯ движения. Резерв под задачу лентой не пишется: он живёт на
-- самой задаче (tasks.estimate_cents ниже) и снимается тем, что задача уходит из
-- живых статусов. Строка-резерв пережила бы удаление задачи и заморозила бы
-- деньги навсегда, а сверять их было бы нечем.
CREATE TABLE IF NOT EXISTS billing_transactions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  -- = tasks.id = processing_stats.item_id. Без внешнего ключа намеренно: задачи
  -- чистятся и удаляются вместе с проектом, деньги остаются.
  task_id    TEXT,
  wallet     TEXT NOT NULL CHECK (wallet IN ('own', 'gift')),
  grant_id   TEXT REFERENCES billing_grants(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL CHECK (kind IN (
               'topup',     -- пополнение деньгами → own
               'grant',     -- подарок → gift
               'charge',    -- списание по факту завершённой обработки
               'refund',    -- возврат
               'writeoff',  -- разница, которую съели мы: факт превысил остаток gift
               'exempt',    -- работа без оплаты (админ): сумма посчитана, движения нет
               'adjust'     -- ручная правка, всегда с автором и комментарием
             )),
  -- Знак значим: + приход, − расход. У exempt всегда 0 — сумма лежит в раскладке.
  amount_cents BIGINT NOT NULL,

  -- Раскладка (П5). Неотрицательные, в копейках, всегда в рублях.
  -- vendor_cents показывается пользователю ПО СЕБЕСТОИМОСТИ; маржа отдельно и
  -- внутри нашей строки — иначе «сторонние сервисы» перестают быть проверяемой
  -- правдой.
  our_cents    BIGINT NOT NULL DEFAULT 0 CHECK (our_cents >= 0),
  vendor_cents BIGINT NOT NULL DEFAULT 0 CHECK (vendor_cents >= 0),
  margin_cents BIGINT NOT NULL DEFAULT 0 CHECK (margin_cents >= 0),

  -- Как считали: ПРИМЕНЁННЫЕ значения, а не ссылки на текущие настройки. Иначе
  -- правка тарифа перепишет прошлые месяцы.
  vendor_currency  TEXT,             -- валюта себестоимости до пересчёта (пока USD)
  vendor_rate      NUMERIC(18, 6),   -- курс, по которому пересчитали
  vendor_rate_src  TEXT,
  pay_base         TEXT CHECK (pay_base IN ('output','source','render','fixed')),
  pay_meter        TEXT CHECK (pay_meter IN ('sec','count','bytes')),
  units            NUMERIC(18, 4),
  unit_rate_cents  BIGINT,
  margin_pct       NUMERIC(6, 3),

  -- Кто распорядился: заполнен у grant, adjust, topup вручную.
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  comment       TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Одно списание на задачу. Держит база, а не код: taskDone идемпотентен, импорт
-- архива переигрывается, и обе линии могут дойти до одной задачи.
CREATE UNIQUE INDEX IF NOT EXISTS billing_transactions_charge_once_idx
  ON billing_transactions (task_id)
  WHERE task_id IS NOT NULL AND kind IN ('charge', 'exempt');

-- Остаток кошелька — сумма по пользователю; отчёты — по периоду и проекту.
CREATE INDEX IF NOT EXISTS billing_transactions_user_idx
  ON billing_transactions (user_id, wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_transactions_project_idx
  ON billing_transactions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_transactions_grant_idx
  ON billing_transactions (grant_id) WHERE grant_id IS NOT NULL;

-- ── Кэш остатков ────────────────────────────────────────────────────────────
--
-- Именно кэш: истина — сумма по ленте. Свой кошелёк уходит в минус (это долг,
-- П3), подарочный — никогда, поэтому CHECK только на нём.
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_gift_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_own_cents  BIGINT NOT NULL DEFAULT 0;

-- Старая balance_cents становится наследием: она ничем не подкреплена, а новый
-- инвариант — «остаток есть сумма ленты». Ненулевые значения переносим строкой
-- adjust, иначе баланс с первого дня разошёлся бы с историей. На нулях это
-- ничего не делает. Саму колонку удалим, когда кабинет и админка перейдут на
-- новые поля.
INSERT INTO billing_transactions (
  id, user_id, wallet, kind, amount_cents, comment, created_at
)
-- Id детерминированный, а не случайный: на этой базе UUID генерирует Node, а
-- gen_random_uuid() есть не во всех версиях Postgres. Заодно повтор миграции
-- становится безвредным.
SELECT 'legacy-balance-' || u.id, u.id, 'own', 'adjust',
       u.balance_cents, 'Перенос из legacy users.balance_cents', NOW()
  FROM users u
 WHERE COALESCE(u.balance_cents, 0) <> 0
    ON CONFLICT (id) DO NOTHING;

UPDATE users SET balance_own_cents = COALESCE(balance_cents, 0)
 WHERE COALESCE(balance_cents, 0) <> 0;

-- Освобождение от оплаты — поле, а не проверка роли в коде: роль могут выдать
-- тому, кому бесплатная обработка не полагается, а освобождение иногда нужно и
-- не-админу (демо-аккаунт, партнёр).
ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_exempt BOOLEAN NOT NULL DEFAULT FALSE;

-- NULL = общий лимит из настроек. Своё значение — постоянному клиенту.
ALTER TABLE users ADD COLUMN IF NOT EXISTS overdraft_limit_cents BIGINT;

-- Роли перечислены обе намеренно. Миграция 2026-08-27-superadmin-role.sql
-- применяется ПОСЛЕ этой (лексикографический порядок) и превращает всех ADMIN в
-- SUPERADMIN, а на свежей базе db/schema.sql может завести суперадмина сразу.
-- Условие на одну роль сработало бы в одном из этих путей и промолчало в другом.
UPDATE users SET billing_exempt = TRUE
 WHERE role IN ('ADMIN', 'SUPERADMIN') AND billing_exempt = FALSE;

-- ── Проекты: единица тарификации и шаблоны ──────────────────────────────────
--
-- Две оси (П6). Дублируют объявленное в графе: в старые графы новое свойство
-- ноды description само не приезжает, поэтому настройка проекта — не временный
-- костыль, а постоянная страховка.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pay_base  TEXT
  CHECK (pay_base IN ('output','source','render','fixed'));
ALTER TABLE projects ADD COLUMN IF NOT EXISTS pay_meter TEXT
  CHECK (pay_meter IN ('sec','count','bytes'));

-- Ожидаемое количество единиц на элемент. Задаётся на шаблоне; для остальных
-- считается по истории, поэтому чаще всего NULL.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS estimate_units NUMERIC(18, 4);

-- Шаблон пробного набора. Обычный проект служебного аккаунта; из слежения
-- исключается, чтобы не обрабатывал сам себя.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_template    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_order INTEGER;

-- Почему проект встал. NULL — остановлен человеком.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS paused_reason TEXT
  CHECK (paused_reason IN ('no-funds', 'trial-over'));

CREATE INDEX IF NOT EXISTS projects_template_idx
  ON projects (template_order) WHERE is_template;

-- ── Задачи: резерв ──────────────────────────────────────────────────────────
--
-- Резерв — это сама задача. Ушла из ('queued','claimed','running') — резерв снят,
-- отпускать нечего: упала, вернули, протухла аренда, удалили проект — во всех
-- случаях само. Кошелёк выбирается один раз, на входе, и не меняется (П3).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_cents BIGINT NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pay_wallet TEXT
  CHECK (pay_wallet IN ('own', 'gift'));
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pay_grant_id TEXT
  REFERENCES billing_grants(id) ON DELETE SET NULL;

-- Сумма живых резервов по пользователю — запрос на каждый допуск, поэтому индекс.
CREATE INDEX IF NOT EXISTS tasks_reserve_idx
  ON tasks (project_id, status)
  WHERE status IN ('queued', 'claimed', 'running', 'done');

-- ── Настройки тарификации ───────────────────────────────────────────────────
--
-- Синглтон с JSONB и revision — тот же приём, что у automation_settings:
-- ставки, маржа, пороги и размер подарка это одно распоряжение, и меняются они
-- целиком. revision растёт на каждую запись, это счётчик оптимистической
-- блокировки, а не хеш содержимого.
CREATE TABLE IF NOT EXISTS billing_settings (
  id         TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision   INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO billing_settings (id, settings)
VALUES ('singleton', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
