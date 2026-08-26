/**
 * Поддельный синтез речи.
 *
 * Существует ровно затем, чтобы весь путь озвучки — клип на таймлинии, волна,
 * воспроизведение, подстройка, экспорт — можно было проверить до появления
 * настоящего провайдера. Поэтому она отдаёт **настоящий звук**, а не путь-обманку:
 * иначе первая же реальная генерация вскрыла бы десяток мест, которые никто не
 * видел работающими.
 *
 * Речью это не притворяется — слышно тон. Но длительность считается по тексту,
 * форма волны повторяет слова и паузы, а темп, голос и интонация у каждой
 * генерации свои, поэтому на таймлинии клип выглядит и ведёт себя так же, как
 * настоящий, и две версии одной реплики слышно как две разные.
 *
 * Случайность приходит снаружи — числом `seed`. Сам модуль детерминирован: тот же
 * текст с тем же seed даёт побайтово тот же файл. Иначе его нельзя было бы
 * проверить, а тейк — воспроизвести.
 *
 * Заменяется одним модулем: «текст → байты». Всё остальное — запись в папку,
 * пики, тейк в документе, очередь, интерфейс — от провайдера не зависит.
 */

export { encodeWav } from "./wav"

/** Сколько звучит один знак. Средний темп речи — около 16 знаков в секунду. */
const MS_PER_CHAR = 62
const MIN_MS = 400
const MAX_MS = 30_000
/** Речь укладывается в 24 кГц с запасом, а файл вдвое меньше, чем при 48. */
export const STUB_SAMPLE_RATE = 24_000

/** Насколько тейк может отличаться от тейка: темп и высота голоса. */
const TEMPO_SPREAD = 0.14
const PITCH_SPREAD = 0.09

export type StubVoice = {
  /** Частота тона: разная у дорожек, чтобы персонажи различались на слух. */
  hz: number
  sampleRate?: number
  /**
   * Отклонения этой генерации: темп, высота голоса, интонация.
   *
   * Без него все тейки одной реплики выходят побайтово одинаковыми, и ни список
   * версий, ни «вписать в реплику» на них не проверить. Число приходит снаружи —
   * так модуль остаётся детерминированным.
   */
  seed?: number
}

export type StubResult = {
  samples: Int16Array
  sampleRate: number
  durationMs: number
}

/**
 * Длительность будущего тейка по тексту, без отклонения темпа.
 *
 * Считается отдельно, потому что нужна и до синтеза: очередь показывает, сколько
 * примерно займёт результат, ещё не имея звука.
 */
export function stubDurationMs(text: string): number {
  const chars = text.replace(/\s+/g, " ").trim().length
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(chars * MS_PER_CHAR)))
}

/**
 * Детерминированный генератор чисел (mulberry32).
 *
 * Свой, а не `Math.random`: тейк с известным seed должен получаться тем же
 * файлом, иначе проверить синтез нечем.
 */
function rng(seed: number): () => number {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Разбор текста на «слова и паузы».
 *
 * Теги в квадратных скобках (`[laugh]`) — это указания провайдеру, а не то, что
 * произносят: они дают паузу, а не всплеск. Знаки конца предложения удлиняют
 * паузу, запятая — короткая.
 */
function beats(text: string): { word: number; pause: number; ends: boolean; asks: boolean }[] {
  const out: { word: number; pause: number; ends: boolean; asks: boolean }[] = []
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean)
  for (const token of tokens) {
    if (/^\[[^\]]*]$/.test(token)) {
      // Тег целиком: не произносится, но пауза на его месте слышна.
      out.push({ word: 0, pause: 2, ends: false, asks: false })
      continue
    }
    const bare = token.replace(/\[[^\]]*]/g, "")
    const letters = bare.replace(/[^\p{L}\p{N}]/gu, "").length
    if (letters === 0) continue
    const sentence = /[.!?…]$/.test(bare)
    const comma = /[,;:]$/.test(bare)
    out.push({
      word: letters,
      pause: sentence ? 3 : comma ? 1.5 : 1,
      ends: sentence,
      asks: /[?]$/.test(bare),
    })
  }
  return out.length > 0 ? out : [{ word: 3, pause: 1, ends: true, asks: false }]
}

/**
 * Синтез: тон с огибающей по словам и интонацией по фразе.
 *
 * Слоги внутри слова размечаются раскрытым косинусом, между словами — тишина. Так
 * волна на таймлинии показывает, где речь, а где пауза, — а именно по волне
 * человек и правит тайминги.
 *
 * Сверх этого — то, из чего складывается «разные тейки»: у каждой генерации свой
 * темп и своя высота голоса, внутри фразы тон сползает вниз, а перед вопросом
 * поднимается, у каждого слога свой небольшой сдвиг. К тону подмешаны обертоны и
 * немного шума по огибающей — без шума тон звучит как сигнал будильника, а с ним
 * похоже на речь, не разобрать только слов.
 */
export function synthesizeStub(text: string, voice: StubVoice): StubResult {
  const sampleRate = voice.sampleRate ?? STUB_SAMPLE_RATE
  const random = rng(voice.seed ?? 1)

  // Темп и голос этой генерации. Читаются первыми и всегда, чтобы дальше
  // последовательность чисел не зависела от текста.
  const tempo = 1 + (random() * 2 - 1) * TEMPO_SPREAD
  const pitch = voice.hz * (1 + (random() * 2 - 1) * PITCH_SPREAD)
  const breath = 0.05 + random() * 0.05

  const nominal = stubDurationMs(text)
  const total = Math.max(
    1,
    Math.round((Math.min(MAX_MS, Math.max(MIN_MS, nominal * tempo)) / 1000) * sampleRate),
  )
  const samples = new Int16Array(total)

  const parts = beats(text)
  const weight = parts.reduce((sum, p) => sum + p.word + p.pause, 0)
  const unit = total / weight
  // Слог — около 180 мс, чуть по-разному у разных генераций.
  const syllable = Math.max(1, Math.round(sampleRate * (0.15 + random() * 0.07)))

  let at = 0
  for (const [index, part] of parts.entries()) {
    const wordLength = Math.round(part.word * unit)
    const pauseLength = Math.round(part.pause * unit)
    // Интонация: к концу фразы тон ниже, перед вопросом — выше. Плюс свой сдвиг
    // на слово, иначе речь звучит роботом даже с обертонами.
    const decline = 1 - 0.12 * (index / Math.max(1, parts.length - 1))
    const question = part.asks ? 1.18 : 1
    const jitter = 1 + (random() * 2 - 1) * 0.05
    const hz = pitch * decline * question * jitter

    for (let i = 0; i < wordLength && at + i < total; i += 1) {
      const inSyllable = i % syllable
      // Раскрытый косинус: мягкий вход и выход, без щелчков на границах.
      const envelope = 0.5 - 0.5 * Math.cos((2 * Math.PI * inSyllable) / syllable)
      const wobble = 1 + 0.035 * Math.sin((2 * Math.PI * i) / (sampleRate * 0.22))
      const phase = (2 * Math.PI * hz * wobble * i) / sampleRate
      const value =
        Math.sin(phase) * 0.26 +
        Math.sin(phase * 2) * 0.07 +
        Math.sin(phase * 3) * 0.03 +
        (random() * 2 - 1) * breath
      samples[at + i] = Math.round(Math.max(-1, Math.min(1, value * envelope)) * 32767)
    }
    at += wordLength + pauseLength
    if (at >= total) break
  }

  return { samples, sampleRate, durationMs: Math.round((total / sampleRate) * 1000) }
}

/**
 * Частота тона по номеру дорожки.
 *
 * Разброс в пределах речевого диапазона: чётные номера ниже, нечётные выше, — так
 * два соседних персонажа не звучат одинаково, и на слух понятно, что дорожки
 * разные.
 */
export function stubVoiceHz(trackNo: number): number {
  const ladder = [196, 262, 220, 294, 247, 330, 175, 349]
  return ladder[Math.abs(trackNo) % ladder.length]
}
