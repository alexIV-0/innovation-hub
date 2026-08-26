/**
 * Сборка ZIP без сжатия (метод `store`).
 *
 * Зачем свой, а не библиотека: класть в зависимости архиватор ради нескольких
 * текстовых файлов по десятку килобайт несоразмерно. Сжатие титрам почти ничего
 * не даёт на таких объёмах, а `store` — это заголовок, данные и опись, то есть
 * код, который помещается в один экран и переезжает в локальный редактор
 * программы вместе с остальной чистой логикой.
 *
 * Ограничения намеренные: без ZIP64, то есть до 4 ГБ и до 65 535 файлов. Для
 * экспорта титров это недостижимо, а проверка стоит две строки — молча выдать
 * битый архив хуже, чем отказаться.
 */

export type ZipEntry = {
  /** Имя внутри архива. Разделитель — только косая черта. */
  name: string
  /** Содержимое. Текст пишется в UTF-8. */
  text: string
}

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const END_OF_CENTRAL = 0x06054b50
/** Имена и содержимое в UTF-8 — бит 11 общего флага. */
const FLAG_UTF8 = 0x0800
const MAX_ENTRIES = 0xffff
const MAX_SIZE = 0xffffffff

export function buildZip(entries: ZipEntry[], modified: Date): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`ZIP without ZIP64 holds at most ${MAX_ENTRIES} entries.`)
  }

  const encoder = new TextEncoder()
  const time = dosTime(modified)
  const date = dosDate(modified)

  const files = entries.map((entry) => {
    const name = encoder.encode(entry.name)
    const data = encoder.encode(entry.text)
    return { name, data, crc: crc32(data) }
  })

  const localSize = files.reduce((sum, f) => sum + 30 + f.name.length + f.data.length, 0)
  const centralSize = files.reduce((sum, f) => sum + 46 + f.name.length, 0)
  const total = localSize + centralSize + 22
  if (total > MAX_SIZE) throw new Error("ZIP without ZIP64 is limited to 4 GB.")

  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  let offset = 0
  const offsets: number[] = []

  for (const file of files) {
    offsets.push(offset)
    view.setUint32(offset, LOCAL_HEADER, true)
    view.setUint16(offset + 4, 20, true) // версия, необходимая для распаковки
    view.setUint16(offset + 6, FLAG_UTF8, true)
    view.setUint16(offset + 8, 0, true) // метод: store
    view.setUint16(offset + 10, time, true)
    view.setUint16(offset + 12, date, true)
    view.setUint32(offset + 14, file.crc, true)
    view.setUint32(offset + 18, file.data.length, true) // сжатый размер
    view.setUint32(offset + 22, file.data.length, true) // исходный размер
    view.setUint16(offset + 26, file.name.length, true)
    view.setUint16(offset + 28, 0, true) // extra
    offset += 30
    out.set(file.name, offset)
    offset += file.name.length
    out.set(file.data, offset)
    offset += file.data.length
  }

  const centralStart = offset
  for (const [index, file] of files.entries()) {
    view.setUint32(offset, CENTRAL_HEADER, true)
    view.setUint16(offset + 4, 20, true) // версия создателя
    view.setUint16(offset + 6, 20, true) // версия для распаковки
    view.setUint16(offset + 8, FLAG_UTF8, true)
    view.setUint16(offset + 10, 0, true)
    view.setUint16(offset + 12, time, true)
    view.setUint16(offset + 14, date, true)
    view.setUint32(offset + 16, file.crc, true)
    view.setUint32(offset + 20, file.data.length, true)
    view.setUint32(offset + 24, file.data.length, true)
    view.setUint16(offset + 28, file.name.length, true)
    view.setUint16(offset + 30, 0, true) // extra
    view.setUint16(offset + 32, 0, true) // комментарий
    view.setUint16(offset + 34, 0, true) // номер диска
    view.setUint16(offset + 36, 0, true) // внутренние атрибуты
    view.setUint32(offset + 38, 0, true) // внешние атрибуты
    view.setUint32(offset + 42, offsets[index], true)
    offset += 46
    out.set(file.name, offset)
    offset += file.name.length
  }

  view.setUint32(offset, END_OF_CENTRAL, true)
  view.setUint16(offset + 4, 0, true) // номер диска
  view.setUint16(offset + 6, 0, true) // диск с началом описи
  view.setUint16(offset + 8, files.length, true)
  view.setUint16(offset + 10, files.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, centralStart, true)
  view.setUint16(offset + 20, 0, true) // комментарий архива

  return out
}

/**
 * Имя файла внутри архива.
 *
 * Убирается всё, что распаковщик может понять как путь или что не переживёт
 * файловую систему: разделители, двоеточие, звёздочка, кавычки, угловые скобки.
 * Кириллица остаётся — архив помечен как UTF-8.
 */
export function safeEntryName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "_")
    .slice(0, 120)
  return cleaned || "untitled"
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date: Date): number {
  return (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
}

function dosDate(date: Date): number {
  const year = Math.max(1980, date.getFullYear())
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
}
