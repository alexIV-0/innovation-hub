/**
 * Резолвер для проверок над `lib/` под `--experimental-strip-types`.
 *
 * Импорты в репозитории без расширений (так их разрешает бандлер Next), а node
 * требует точный путь. Хук дописывает `.ts` — только это, никакой трансформации
 * кода: типы снимает сам node.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context)
    } catch {
      // Не `.ts` — пусть решает штатный резолвер.
    }
  }
  return nextResolve(specifier, context)
}
