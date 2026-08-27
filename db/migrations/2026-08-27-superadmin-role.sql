-- Третья роль: SUPERADMIN. Этап 1 плана docs/ADMIN_ROLES_PLAN.md.
--
-- Прав эта миграция никому не добавляет и не убавляет: пока код спрашивает
-- только isElevated(), суперадмин по возможностям равен админу. Меняется
-- потолок — появляется ступень, с которой позже будут раздаваться роли и теги.
--
-- Повышаются ВСЕ действующие админы, а не один назначенный. Это выбор в пользу
-- непрерывности: на выкатке никто не теряет доступ, а разбор «кому что оставить»
-- делается потом вручную (этап 5). Расширением прав это не является — сегодня
-- любой админ и так заводит второго админа и удаляет коллегу.
--
-- ВАЖНО про парк машин: mch_-токен берёт роль живым JOIN'ом из users
-- (lib/storage/auth.ts), поэтому после этого UPDATE каждая проверка вида
-- `auth.role === "ADMIN"` на машинных путях молча стала бы false, и машина
-- потеряла бы общую очередь и чужие проекты. Правки этих мест едут В ЭТОМ ЖЕ
-- деплое — см. §7 плана. Отдельно от них миграцию катить нельзя.

-- Проверка роли безымянная: колоночный CHECK в CREATE TABLE (db/schema.sql),
-- имя ей выдал Postgres. Ищем по каталогу, а не по угаданному имени — по той же
-- причине, что и в db/migrations/2026-08-25-project-share-roles.sql: не совпади
-- имя, DROP ... IF EXISTS промолчал бы, ADD добавил вторую проверку, и роль
-- 'SUPERADMIN' отвергалась бы старой — молча и только на боевой базе.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'users'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('USER', 'ADMIN', 'SUPERADMIN'));

DO $$
DECLARE
  promoted INT;
BEGIN
  UPDATE users SET role = 'SUPERADMIN' WHERE role = 'ADMIN';
  GET DIAGNOSTICS promoted = ROW_COUNT;

  IF promoted = 0 THEN
    -- Не падаем: на пустой базе это нормально, первого заводит scripts/db-init.mjs.
    -- Но молчать нельзя — без единого суперадмина систему не разблокировать
    -- изнутри, роли и теги будет некому раздать.
    RAISE WARNING 'Админов не найдено — суперадмин не создан. Заведите его вручную или через ADMIN_EMAIL в db:init.';
  ELSE
    RAISE NOTICE 'Повышено до SUPERADMIN: %', promoted;
  END IF;
END $$;
