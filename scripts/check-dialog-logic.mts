#!/usr/bin/env node
/**
 * Проверки чистой логики папки задачи — `lib/tools/dialog/`.
 *
 *   npm run dialog:check
 *
 * Тестраннера в проекте нет, а правила выбора файлов держатся на договорённостях
 * с обработкой: какое видео играть, какой `.srt` чей, что собирается в документ.
 * Ошибка здесь не падает исключением — она молча подставляет человеку чужой
 * текст или пустой кадр, поэтому проверки написаны отдельно и запускаются руками.
 *
 * Проверяется только то, что не требует ни браузера, ни сети.
 */

import {
  buildDocFromFolder,
  mergeRebuild,
  type TaskEntry,
} from "../lib/tools/dialog/build-doc.ts"
import { parseDialogDoc } from "../lib/tools/dialog/dialog-doc.ts"
import { isProxyName, looksLikeVideo, pickVideoName } from "../lib/tools/dialog/media-files.ts"
import { langFromName, pickSrtName, wantFromSourcePath } from "../lib/tools/dialog/srt-files.ts"
import { taskItems, type TreeEntry } from "../components/account/tools/shared/project-rules.ts"

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  const ok = a === b
  if (!ok) fails += 1
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `: ${a}, ждали ${b}`}`)
}
const files = (...names: string[]) => names.map((name) => ({ name }))

console.log("выбор видео (media-files.ts)")
eq("прокси старше мастера", pickVideoName(files("master.mov", "proxy.mp4")), "proxy.mp4")
eq("прокси старше mp4-мастера", pickVideoName(files("master.mp4", "proxy.mp4")), "proxy.mp4")
eq("суффикс в имени", pickVideoName(files("clip_042.mp4", "clip_042_proxy.mp4")), "clip_042_proxy.mp4")
eq("preview — тоже прокси", pickVideoName(files("source.mp4", "preview.mp4")), "preview.mp4")
eq("прокси по-русски", pickVideoName(files("мастер.mov", "прокси.mp4")), "прокси.mp4")
eq("нет прокси — mp4", pickVideoName(files("master.mov", "source.mp4")), "source.mp4")
eq("нет mp4 — что есть", pickVideoName(files("master.mov")), "master.mov")
eq("не видео не берётся", pickVideoName(files("dialog.json", "mix.peaks.json")), null)
eq("пустая папка", pickVideoName([]), null)
eq("два mp4 — по имени", pickVideoName(files("b.mp4", "a.mp4")), "a.mp4")
eq("proxyserver — не прокси", pickVideoName(files("proxyserver.mp4", "a.mp4")), "a.mp4")
eq("слитно — не прокси", isProxyName("myproxy.mp4"), false)
eq("отбито — прокси", isProxyName("my-proxy.mp4"), true)
eq("тип из каталога без расширения", pickVideoName([{ name: "clip", contentType: "video/mp4" }]), "clip")
eq("json — не видео", looksLikeVideo({ name: "dialog.json" }), false)
eq("порядок входа не влияет", pickVideoName(files("proxy.mp4", "master.mov")), "proxy.mp4")

console.log("выбор титров (srt-files.ts)")
const folder = ["original.srt", "dialog_rus.srt", "speaker_01_eng.srt", "audio.wav"]
eq("оригинал по слову", pickSrtName(folder, { kind: "original", lang: "en" }), "original.srt")
eq("перевод rus", pickSrtName(folder, { kind: "lang", lang: "ru" }), "dialog_rus.srt")
eq("перевода es нет", pickSrtName(folder, { kind: "lang", lang: "es" }), null)
eq(
  "оригинал по языку, без слова",
  pickSrtName(["speaker_01_eng.srt", "speaker_01_rus.srt"], { kind: "original", lang: "en" }),
  "speaker_01_eng.srt",
)
eq("единственный .srt — оригинал", pickSrtName(["cues.srt"], { kind: "original", lang: null }), "cues.srt")
eq("единственный .srt — не перевод", pickSrtName(["cues.srt"], { kind: "lang", lang: "ru" }), null)
eq(
  "original_rus.srt — не перевод",
  pickSrtName(["original_rus.srt", "перевод_рус.srt"], { kind: "lang", lang: "ru" }),
  "перевод_рус.srt",
)
eq(
  "регион точнее базы",
  pickSrtName(["dialog_pt.srt", "dialog_pt-BR.srt"], { kind: "lang", lang: "pt-BR" }),
  "dialog_pt-BR.srt",
)
eq("слитное имя не распознаётся", pickSrtName(["dialogRUS.srt"], { kind: "lang", lang: "ru" }), null)
eq("контрактное имя", pickSrtName(["ru.srt", "orig.srt"], { kind: "lang", lang: "ru" }), "ru.srt")
eq("язык из имени: _RUS", langFromName("dialog_RUS.srt"), "ru")
eq("язык из имени: -eng", langFromName("speaker-eng.srt"), "en")
eq("язык из имени: _RU заглавными", langFromName("subs_RU.srt"), "ru")
eq("язык из имени: _Ru вперемешку", langFromName("dialog_Ru.srt"), "ru")
eq("язык из имени: оригинал", langFromName("original.srt"), null)
eq("язык из имени: нет языка", langFromName("dialog_2024.srt"), null)
eq("путь orig.srt", wantFromSourcePath("01/orig.srt", "en"), { kind: "original", lang: "en" })
eq("путь es.srt", wantFromSourcePath("01/es.srt", "en"), { kind: "lang", lang: "es" })
eq("путь чужого имени", wantFromSourcePath("01/dialog_2024.srt", "en"), null)

console.log("сборка документа (build-doc.ts)")
const srtFile = (blocks: [number, string, string, string][]) =>
  blocks.map(([i, from, to, text]) => `${i}\n${from} --> ${to}\n${text}\n`).join("\n")

const entries: TaskEntry[] = [
  { dir: "", name: "master.mov", isFolder: false },
  { dir: "", name: "proxy.mp4", isFolder: false },
  { dir: "", name: "01", isFolder: true },
  { dir: "", name: "02", isFolder: true },
  { dir: "01", name: "orig.srt", isFolder: false },
  { dir: "01", name: "dialog_RUS.srt", isFolder: false },
  { dir: "01", name: "audio.wav", isFolder: false },
  { dir: "02", name: "original.srt", isFolder: false },
  { dir: "02", name: "notes.txt", isFolder: false },
]
const srt = new Map<string, string>([
  [
    "01/orig.srt",
    srtFile([
      [1, "00:00:01,000", "00:00:03,000", "Hello there."],
      [2, "00:00:04,000", "00:00:06,500", "How are you?"],
    ]),
  ],
  ["01/dialog_RUS.srt", srtFile([[1, "00:00:01,000", "00:00:03,000", "Привет."]])],
  ["02/original.srt", srtFile([[1, "00:00:07,000", "00:00:09,000", "Fine, thanks."]])],
])
const base = { srt, durationMs: 12_000, originalLang: "en", docId: "dd_test", now: "2026-09-03T10:00:00.000Z" }
const { doc, notes } = buildDocFromFolder({ entries, ...base })

eq("две дорожки", doc.tracks.length, 2)
eq("номера из имён папок", doc.tracks.map((t) => t.no), [1, 2])
eq("id дорожек", doc.tracks.map((t) => t.id), ["t01", "t02"])
eq("стем найден", doc.tracks[0]!.audio, "01/audio.wav")
eq("стема нет — null", doc.tracks[1]!.audio, null)
eq("пики не выдуманы", doc.tracks.map((t) => t.peaks), [null, null])
eq("машинное имя не выдумано", doc.tracks[0]!.origin, { kind: "auto" })
eq("реплик всего", doc.cues.length, 3)
eq("реплики отсортированы", doc.cues.map((c) => c.startMs), [1000, 4000, 7000])
eq("origin ведёт к файлу", doc.cues[0]!.origin, { kind: "auto", file: "01/orig.srt", index: 1 })
eq("перевод подхвачен", doc.cues[0]!.tr, { ru: { text: "Привет.", status: "draft" } })
eq("без перевода — пусто", doc.cues[1]!.tr, {})
eq("язык RUS → ru", doc.languages, { original: "en", targets: ["ru"] })
eq("прокси предпочтён", doc.media.video, "proxy.mp4")
eq("mix пуст при видео", doc.media.mix, null)
eq("детерминированные id", doc.cues.map((c) => c.id), ["c_t01_1", "c_t01_2", "c_t02_1"])
eq("короткий перевод замечен", notes, [{ kind: "shortTranslation", file: "01/ru", missing: 1 }])
eq("документ проходит валидацию", parseDialogDoc(JSON.parse(JSON.stringify(doc))).ok, true)
eq(
  "пересборка даёт то же самое",
  JSON.stringify(buildDocFromFolder({ entries, ...base }).doc) === JSON.stringify(doc),
  true,
)

const audioOnly = buildDocFromFolder({
  entries: [
    { dir: "", name: "mix.wav", isFolder: false },
    { dir: "", name: "speaker_anna", isFolder: true },
    { dir: "speaker_anna", name: "original.srt", isFolder: false },
  ],
  srt: new Map([["speaker_anna/original.srt", srtFile([[1, "00:00:00,500", "00:00:02,000", "Hi."]])]]),
  durationMs: 0,
  originalLang: "en",
  docId: "dd_audio",
  now: base.now,
})
eq("общий звук как mix", audioOnly.doc.media.mix, "mix.wav")
eq("свободное имя папки — номер по порядку", audioOnly.doc.tracks[0]!.no, 1)
eq("длительность по последней реплике", audioOnly.doc.media.durationMs, 2000)

// Один `.srt` в папке — оригинал, даже если в имени назван язык: перепутать
// его не с чем, а отказать значило бы не собрать дорожку на ровном месте.
const lonely = buildDocFromFolder({
  entries: [
    { dir: "", name: "03", isFolder: true },
    { dir: "03", name: "dialog_ru.srt", isFolder: false },
  ],
  srt: new Map([["03/dialog_ru.srt", srtFile([[1, "00:00:00,000", "00:00:01,000", "Раз."]])]]),
  durationMs: 0,
  originalLang: "en",
  docId: "dd_lonely",
  now: base.now,
})
eq("единственный .srt собирает дорожку", lonely.doc.tracks.length, 1)
eq("и переводом не считается", lonely.doc.languages.targets, [])

// Два перевода и ни одного оригинала — собирать нечего, и это сказано вслух.
const broken = buildDocFromFolder({
  entries: [
    { dir: "", name: "03", isFolder: true },
    { dir: "03", name: "dialog_ru.srt", isFolder: false },
    { dir: "03", name: "dialog_es.srt", isFolder: false },
  ],
  srt: new Map(),
  durationMs: 0,
  originalLang: "en",
  docId: "dd_broken",
  now: base.now,
})
eq("нет оригинала — дорожка не собрана", broken.doc.tracks.length, 0)
eq("и об этом сказано", broken.notes, [{ kind: "noOriginal", dir: "03" }, { kind: "noTracks" }])

console.log("поиск задач в OUT (project-rules.ts)")
const tree: TreeEntry[] = [
  { name: "Notting_Hill", folderPath: "OUT", isFolder: true },
  { name: "dialog.json", folderPath: "OUT/Notting_Hill", isFolder: false },
  { name: "01", folderPath: "OUT/Notting_Hill", isFolder: true },
  { name: "orig.srt", folderPath: "OUT/Notting_Hill/01", isFolder: false },
  { name: "Клиент А", folderPath: "OUT", isFolder: true },
  { name: "Ролик_7", folderPath: "OUT/Клиент А", isFolder: true },
  { name: "02", folderPath: "OUT/Клиент А/Ролик_7", isFolder: true },
  { name: "original.srt", folderPath: "OUT/Клиент А/Ролик_7/02", isFolder: false },
  { name: "readme.txt", folderPath: "OUT", isFolder: false },
  { name: "loose.srt", folderPath: "OUT", isFolder: false },
]
eq("первый уровень", taskItems(tree, "OUT", { rule: "folders" }), ["Notting_Hill", "Клиент А"])
// Правило глубины буквальное: на втором уровне лежат и папки дорожек задачи
// первого уровня. Для смешанной раскладки есть «найти самому».
eq("второй уровень — буквально", taskItems(tree, "OUT", { rule: "folders2" }), [
  "Notting_Hill/01",
  "Клиент А/Ролик_7",
])
eq(
  "авто: и по документу, и по папкам дорожек",
  taskItems(tree, "OUT", { rule: "auto" }),
  ["Klient A/Rolik_7".replace("Klient A/Rolik_7", "Клиент А/Ролик_7"), "Notting_Hill"].sort((a, b) =>
    a.localeCompare(b),
  ),
)
eq("авто не считает задачей папку дорожки", taskItems(tree, "OUT", { rule: "auto" }).includes("Notting_Hill/01"), false)
eq("только srt", taskItems(tree, "OUT", { rule: "srt" }), ["loose.srt"])
eq(
  "всё содержимое корня",
  taskItems(tree, "OUT", { rule: "flat" }),
  ["loose.srt", "Notting_Hill", "readme.txt", "Клиент А"].sort((a, b) => a.localeCompare(b)),
)
eq("порядок всегда по алфавиту", taskItems(tree.slice().reverse(), "OUT", { rule: "folders" }), [
  "Notting_Hill",
  "Клиент А",
])

console.log("пересборка с сохранением правок (mergeRebuild)")
// Человек вычитал первую реплику, в папку докинули испанский перевод.
const edited = structuredClone(doc)
edited.revision = 4
edited.cues[0]!.text = "Hello there, friend."
edited.cues[0]!.status = "edited"
edited.cues[0]!.rev = 3

const withSpanish = buildDocFromFolder({
  entries: [...entries, { dir: "01", name: "dialog_es.srt", isFolder: false }],
  ...base,
  srt: new Map([
    ...srt,
    ["01/dialog_es.srt", srtFile([[1, "00:00:01,000", "00:00:03,000", "Hola."]])],
  ]),
}).doc

const rebuilt = mergeRebuild(edited, withSpanish)
const first = rebuilt.cues.find((c) => c.id === "c_t01_1")!
eq("вычитанный текст уцелел", first.text, "Hello there, friend.")
eq("статус правки уцелел", first.status, "edited")
eq("новый перевод дописан", first.tr.es, { text: "Hola.", status: "draft" })
eq("старый перевод на месте", first.tr.ru, { text: "Привет.", status: "draft" })
eq("язык добавлен в targets", rebuilt.languages.targets, ["es", "ru"])
eq("реплик не прибавилось", rebuilt.cues.length, 3)

console.log(fails === 0 ? "\nвсё сошлось" : `\nпровалов: ${fails}`)
process.exit(fails === 0 ? 0 : 1)
