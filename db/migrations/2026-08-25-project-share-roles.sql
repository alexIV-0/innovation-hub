-- Третья роль расшаривания: full — «полный доступ».
--
-- viewer читает, editor правит файлы и настройки, full вдобавок расшаривает
-- проект дальше и отправляет его в архив. Владелец остаётся отдельной сущностью
-- (projects.user_id): его строки в project_members нет и быть не должно — иначе
-- появятся два источника правды о том, кто хозяин папки.
--
-- Проверка роли безымянная: таблица создавалась с CHECK внутри CREATE TABLE
-- (db/migrations/2026-08-13-storage-jobs-sharing.sql), поэтому имя ей выдал
-- Postgres. Ищем её по каталогу, а не по угаданному имени: если оно окажется
-- другим, DROP ... IF EXISTS промолчит, ADD добавит вторую проверку, и роль
-- 'full' будет отвергаться старой — молча и только на боевой базе.
DO $$
DECLARE
  con_name TEXT;
BEGIN
  FOR con_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'project_members'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE project_members DROP CONSTRAINT %I', con_name);
  END LOOP;
END $$;

ALTER TABLE project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('viewer', 'editor', 'full'));

-- Кто кого позвал — уже хранится в invited_by. С делегированием это перестало
-- быть просто историей: владелец должен видеть в диалоге «Поделиться», откуда
-- взялся человек, которого он сам не приглашал. Индекс — для этого показа.
CREATE INDEX IF NOT EXISTS project_members_invited_by_idx
  ON project_members (invited_by)
  WHERE invited_by IS NOT NULL;
