"use client"

/**
 * Настройки вида и раскладка клавиш инструмента озвучки.
 *
 * Своё, а не общее с редактором титров: набора инструментов таймлинии здесь нет
 * вовсе — подстройка тейка делается прямо на клипе, — зато есть то, чего нет у
 * титров: сколько генераций держать в полёте. Общее — в
 * `../shared/editor-state.ts`.
 */

/** Действия с горячей клавишей. Переназначаются в настройках. */
export type VoiceHotkeyAction =
  | "playPause"
  | "mainWave"
  | "generate"
  | "fit"
  | "original"
  | "removeTake"

export const VOICE_HOTKEY_ACTIONS: VoiceHotkeyAction[] = [
  "generate",
  "fit",
  "removeTake",
  "playPause",
  "original",
  "mainWave",
]

export type VoiceKeymap = Record<VoiceHotkeyAction, string>

/**
 * Клавиши — кодом физической кнопки, как и в редакторе титров: `event.key`
 * зависит от раскладки, и на русской привязка к букве просто не работает.
 */
export const DEFAULT_VOICE_KEYMAP: VoiceKeymap = {
  generate: "KeyG",
  fit: "KeyF",
  /**
   * Убрать версию озвучки; с `Shift` — все версии реплики сразу.
   *
   * Модификатор отдельным действием не заводится: это та же работа, только шире,
   * и вторая клавиша под неё делала бы список настроек длиннее без пользы.
   */
  removeTake: "Delete",
  playPause: "Space",
  original: "KeyO",
  mainWave: "KeyW",
}

/**
 * `Backspace` заодно с `Delete`.
 *
 * На ноутбучных клавиатурах Apple кнопка с надписью delete присылает
 * `Backspace`, а `Delete` — только с `Fn`. Без этой поддавки клавиша «не
 * работает» ровно на той машине, где её пробуют. Работает только для значения по
 * умолчанию: если человек назначил свою клавишу, подменять её нечем.
 */
export function matchesHotkey(code: string, bound: string): boolean {
  if (code === bound) return true
  return bound === "Delete" && code === "Backspace"
}

/** Пока форматов больше одного нет: WAV делается в браузере без зависимостей. */
export type VoiceExportFormat = "wav"

export type VoicePrefs = {
  trackH: number
  fontSize: number
  /** Прилипание начала тейка к началу реплики и к соседям. */
  snap: boolean
  mainWave: boolean
  zoom: number
  exportFmt: VoiceExportFormat
  /**
   * Сколько генераций держать в полёте. Провайдер внешний и с ограничениями по
   * частоте: двадцать параллельных запросов вернут ошибки вместо звука.
   */
  concurrency: number
  /**
   * Вписывать свежий тейк в длительность реплики. Две половины по отдельности.
   *
   * Настройки, а не поведение, потому что ответ зависит от материала: в дубляже
   * под картинку вылезать за реплику нельзя, а в озвучке за кадром лишние
   * полсекунды безобидны; растянутая же короткая реплика слышна как замедление, и
   * нужно это далеко не всегда.
   */
  autoFitShrink: boolean
  autoFitStretch: boolean
  keymap: VoiceKeymap
}

export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  trackH: 64,
  fontSize: 14,
  snap: true,
  mainWave: true,
  zoom: 64,
  exportFmt: "wav",
  concurrency: 2,
  // Обе выключены: свежий тейк приходит как синтезировали, и первое, что человек
  // слышит, — результат провайдера, а не наша подгонка. Включает тот, кому она
  // нужна на этом материале.
  autoFitShrink: false,
  autoFitStretch: false,
  keymap: DEFAULT_VOICE_KEYMAP,
}

/** Размеры зон по умолчанию. Дорожки выше, чем у титров: на них теперь волна. */
export const DEFAULT_VOICE_LEFT_W = 420
export const DEFAULT_VOICE_TIMELINE_H = 340

export function voicePrefsKey(toolId: string): string {
  return `ffworks-voice-view:${toolId}`
}
