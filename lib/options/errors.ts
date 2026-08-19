/**
 * Ошибка работы с хранилищем проекта.
 *
 * Живёт отдельным модулем, потому что её кидает и разбор `options.json`
 * ([apply.ts](./apply.ts)), и `lib/project-storage.ts`, который этот разбор
 * вызывает: общий класс в любом из них замкнул бы импорты в цикл.
 * `lib/project-storage.ts` реэкспортирует её — прежние импорты работают.
 */
export class ProjectStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectStorageError"
  }
}
