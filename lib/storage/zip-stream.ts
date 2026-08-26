/**
 * Потоковый ZIP без сжатия (метод `store`) — скачивание папки проекта одним
 * файлом, без промежуточной сборки в бакете и без буфера в памяти.
 *
 * Три решения, от которых зависит всё остальное:
 *
 * 1. **Только `store`.** В папках проектов лежит видео, аудио и картинки —
 *    сжатие даёт единицы процентов, а стоит процессорного времени на каждый
 *    гигабайт. Зато без сжатия размер архива считается заранее, до первого
 *    байта: смотри `zipTotalSize`.
 *
 * 2. **Дескрипторы данных** (бит 3 общего флага). CRC файла на момент записи
 *    локального заголовка неизвестен — байты ещё не прочитаны из R2, а читать
 *    объект дважды означает удвоить исходящий трафик. Поэтому размеры и CRC
 *    уходят в дескриптор *после* данных, а правильные значения дублируются в
 *    описи, откуда их и берёт распаковщик.
 *
 * 3. **Точный `Content-Length`.** Раз размер известен заранее, браузер рисует
 *    настоящий прогресс и остаток времени, а не «неизвестно сколько». Цена —
 *    поток обязан выдать ровно столько байт, сколько обещано, даже если объект
 *    в бакете разошёлся с каталогом: см. добивку нулями в `zipChunks`.
 *
 * ZIP64 включается по расчёту, а не всегда: он нужен, только если часть выходит
 * за 4 ГБ, файлов больше 65 535 или отдельный файл больше 4 ГБ. Обычная часть
 * до 2 ГБ остаётся классическим архивом, который открывает что угодно.
 */

const LOCAL_HEADER_SIG = 0x04034b50
const DATA_DESCRIPTOR_SIG = 0x08074b50
const CENTRAL_HEADER_SIG = 0x02014b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const EOCD_SIG = 0x06054b50

const FLAG_DATA_DESCRIPTOR = 0x0008
/** Имена в UTF-8 — бит 11 общего флага. */
const FLAG_UTF8 = 0x0800

const VERSION_STORE = 20
const VERSION_ZIP64 = 45

const U16_MAX = 0xffff
const U32_MAX = 0xffffffff
/**
 * Порог, за которым 32-битного поля не хватает и запись уходит в ZIP64.
 *
 * Отдельная константа, хотя численно это тот же `U32_MAX`: там он — «смотри
 * ZIP64», значение-заглушка в четырёхбайтном поле, а здесь граница размера.
 * Разные роли одного числа, и путать их дорого: подменив одно вместо другого,
 * получаешь архив, в котором опись указывает на 0x000186a0 вместо смещения.
 */
const ZIP64_THRESHOLD = U32_MAX

const LOCAL_HEADER_SIZE = 30
const CENTRAL_HEADER_SIZE = 46
const EOCD_SIZE = 22
const ZIP64_EOCD_SIZE = 56
const ZIP64_LOCATOR_SIZE = 20
/** Заголовок 0x0001 + два восьмибайтных размера. */
const ZIP64_LOCAL_EXTRA_SIZE = 20
/** То же плюс смещение локального заголовка. */
const ZIP64_CENTRAL_EXTRA_SIZE = 28
const DESCRIPTOR_SIZE = 16
const ZIP64_DESCRIPTOR_SIZE = 24

/** Внешние атрибуты: у папки должен стоять DOS-бит каталога. */
const DOS_ATTR_DIRECTORY = 0x10

const PAD_CHUNK = new Uint8Array(64 * 1024)

export type ZipStreamEntry = {
  /** Путь внутри архива. Разделитель только `/`, у папки — завершающий `/`. */
  path: string
  /** Размер данных по каталогу. У папки 0. */
  size: number
  /** Ключ объекта в R2. У папки null. */
  s3Key: string | null
  /** Дата для DOS-таймстемпа записи. */
  modified: Date
  isDir: boolean
}

export type ZipEntryLayout = {
  entry: ZipStreamEntry
  nameBytes: Uint8Array
  /** Смещение локального заголовка от начала архива. */
  offset: number
  /** Запись требует ZIP64: либо сама больше 4 ГБ, либо лежит за 4 ГБ. */
  zip64: boolean
}

/**
 * Накопитель размера архива. Отдельно от раскладки, потому что разбиение на
 * части (`lib/storage/archive.ts`) спрашивает «а если добавить ещё эту запись?»
 * для каждого файла, и пересчитывать всю раскладку на каждый шаг — это O(n²).
 */
export type ZipSizeAccumulator = {
  count: number
  /** Он же смещение начала описи. */
  dataOffset: number
  centralSize: number
  /** Хотя бы одна запись потребовала ZIP64. */
  entryZip64: boolean
}

export const EMPTY_ZIP_SIZE: ZipSizeAccumulator = {
  count: 0,
  dataOffset: 0,
  centralSize: 0,
  entryZip64: false,
}

export type ZipLayout = {
  entries: ZipEntryLayout[]
  centralOffset: number
  centralSize: number
  /** Архив пишется в формате ZIP64: опись и хвост в 64-битном варианте. */
  zip64: boolean
  totalSize: number
}

const encoder = new TextEncoder()

function needsZip64Entry(size: number, offset: number): boolean {
  return size >= ZIP64_THRESHOLD || offset >= ZIP64_THRESHOLD
}

function localSizeOf(layout: ZipEntryLayout): number {
  return (
    LOCAL_HEADER_SIZE +
    layout.nameBytes.length +
    (layout.zip64 ? ZIP64_LOCAL_EXTRA_SIZE : 0)
  )
}

function descriptorSizeOf(layout: ZipEntryLayout): number {
  // У папки нет данных, а значит и дескриптора: бит 3 для неё не ставится.
  if (layout.entry.isDir) return 0
  return layout.zip64 ? ZIP64_DESCRIPTOR_SIZE : DESCRIPTOR_SIZE
}

function centralSizeOf(layout: ZipEntryLayout): number {
  return (
    CENTRAL_HEADER_SIZE +
    layout.nameBytes.length +
    (layout.zip64 ? ZIP64_CENTRAL_EXTRA_SIZE : 0)
  )
}

/** Нужен ли ZIP64 всему архиву при таком накопленном состоянии. */
function needsZip64Archive(acc: ZipSizeAccumulator): boolean {
  return (
    acc.entryZip64 ||
    acc.count >= U16_MAX ||
    acc.dataOffset >= ZIP64_THRESHOLD ||
    acc.centralSize >= ZIP64_THRESHOLD
  )
}

/** Размер архива целиком: данные, опись и хвост. */
export function zipTotalSize(acc: ZipSizeAccumulator): number {
  const tail = needsZip64Archive(acc)
    ? EOCD_SIZE + ZIP64_EOCD_SIZE + ZIP64_LOCATOR_SIZE
    : EOCD_SIZE
  return acc.dataOffset + acc.centralSize + tail
}

/**
 * Добавляет запись к накопителю и возвращает её раскладку.
 *
 * И расчёт размера, и сам поток идут через эту функцию — иначе обещанный
 * `Content-Length` однажды разойдётся с тем, что реально записано, и архив
 * оборвётся на последнем килобайте.
 */
export function appendZipEntry(
  acc: ZipSizeAccumulator,
  entry: ZipStreamEntry,
): { acc: ZipSizeAccumulator; layout: ZipEntryLayout } {
  const nameBytes = encoder.encode(entry.path)
  const layout: ZipEntryLayout = {
    entry,
    nameBytes,
    offset: acc.dataOffset,
    zip64: needsZip64Entry(entry.size, acc.dataOffset),
  }
  const consumed =
    localSizeOf(layout) + entry.size + descriptorSizeOf(layout)
  return {
    layout,
    acc: {
      count: acc.count + 1,
      dataOffset: acc.dataOffset + consumed,
      centralSize: acc.centralSize + centralSizeOf(layout),
      entryZip64: acc.entryZip64 || layout.zip64,
    },
  }
}

export function planZipLayout(entries: ZipStreamEntry[]): ZipLayout {
  let acc = EMPTY_ZIP_SIZE
  const layouts: ZipEntryLayout[] = []
  for (const entry of entries) {
    const step = appendZipEntry(acc, entry)
    layouts.push(step.layout)
    acc = step.acc
  }
  return {
    entries: layouts,
    centralOffset: acc.dataOffset,
    centralSize: acc.centralSize,
    zip64: needsZip64Archive(acc),
    totalSize: zipTotalSize(acc),
  }
}

// ─── запись ──────────────────────────────────────────────────────────────────

class ByteWriter {
  private readonly bytes: Uint8Array
  private readonly view: DataView
  private offset = 0

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u16(value: number): this {
    this.view.setUint16(this.offset, value, true)
    this.offset += 2
    return this
  }

  u32(value: number): this {
    this.view.setUint32(this.offset, value, true)
    this.offset += 4
    return this
  }

  u64(value: number): this {
    this.view.setBigUint64(this.offset, BigInt(Math.trunc(value)), true)
    this.offset += 8
    return this
  }

  raw(value: Uint8Array): this {
    this.bytes.set(value, this.offset)
    this.offset += value.length
    return this
  }

  done(): Uint8Array {
    if (this.offset !== this.bytes.length) {
      // Расхождение здесь означает, что расчёт размера и запись разъехались,
      // то есть архив уже испорчен. Лучше упасть, чем отдать битый файл.
      throw new Error(
        `ZIP writer wrote ${this.offset} of ${this.bytes.length} bytes.`,
      )
    }
    return this.bytes
  }
}

function dosTime(date: Date): number {
  return (
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  )
}

function dosDate(date: Date): number {
  const year = Math.max(1980, date.getFullYear())
  return ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
}

function localHeader(layout: ZipEntryLayout): Uint8Array {
  const { entry, nameBytes, zip64 } = layout
  const extraSize = zip64 ? ZIP64_LOCAL_EXTRA_SIZE : 0
  const writer = new ByteWriter(
    new Uint8Array(LOCAL_HEADER_SIZE + nameBytes.length + extraSize),
  )
  const flags =
    FLAG_UTF8 | (entry.isDir ? 0 : FLAG_DATA_DESCRIPTOR)

  writer
    .u32(LOCAL_HEADER_SIG)
    .u16(zip64 ? VERSION_ZIP64 : VERSION_STORE)
    .u16(flags)
    .u16(0) // метод: store
    .u16(dosTime(entry.modified))
    .u16(dosDate(entry.modified))
    .u32(0) // CRC — в дескрипторе после данных
    .u32(zip64 ? U32_MAX : 0) // сжатый размер
    .u32(zip64 ? U32_MAX : 0) // исходный размер
    .u16(nameBytes.length)
    .u16(extraSize)
    .raw(nameBytes)

  if (zip64) {
    // Заглушки: настоящие размеры приедут дескриптором. Поле обязано быть
    // здесь — по нему распаковщик понимает, что размеры в дескрипторе
    // восьмибайтные.
    writer.u16(0x0001).u16(16).u64(0).u64(0)
  }
  return writer.done()
}

function dataDescriptor(
  layout: ZipEntryLayout,
  crc: number,
  size: number,
): Uint8Array {
  const writer = new ByteWriter(
    new Uint8Array(layout.zip64 ? ZIP64_DESCRIPTOR_SIZE : DESCRIPTOR_SIZE),
  )
  writer.u32(DATA_DESCRIPTOR_SIG).u32(crc)
  if (layout.zip64) {
    writer.u64(size).u64(size)
  } else {
    writer.u32(size).u32(size)
  }
  return writer.done()
}

function centralHeader(
  layout: ZipEntryLayout,
  crc: number,
  size: number,
): Uint8Array {
  const { entry, nameBytes, zip64 } = layout
  const extraSize = zip64 ? ZIP64_CENTRAL_EXTRA_SIZE : 0
  const writer = new ByteWriter(
    new Uint8Array(CENTRAL_HEADER_SIZE + nameBytes.length + extraSize),
  )
  const version = zip64 ? VERSION_ZIP64 : VERSION_STORE

  writer
    .u32(CENTRAL_HEADER_SIG)
    .u16(version) // создано: MS-DOS
    .u16(version) // требуется для распаковки
    .u16(FLAG_UTF8 | (entry.isDir ? 0 : FLAG_DATA_DESCRIPTOR))
    .u16(0) // метод: store
    .u16(dosTime(entry.modified))
    .u16(dosDate(entry.modified))
    .u32(crc)
    .u32(zip64 ? U32_MAX : size) // сжатый размер
    .u32(zip64 ? U32_MAX : size) // исходный размер
    .u16(nameBytes.length)
    .u16(extraSize)
    .u16(0) // комментарий
    .u16(0) // номер диска
    .u16(0) // внутренние атрибуты
    .u32(entry.isDir ? DOS_ATTR_DIRECTORY : 0)
    .u32(zip64 ? U32_MAX : layout.offset)
    .raw(nameBytes)

  if (zip64) {
    // Порядок полей в 0x0001 закреплён стандартом: размер, сжатый размер,
    // смещение. Пропускать можно только с конца, поэтому пишем все три.
    writer.u16(0x0001).u16(24).u64(size).u64(size).u64(layout.offset)
  }
  return writer.done()
}

function endOfCentralDirectory(input: {
  count: number
  centralSize: number
  centralOffset: number
  zip64: boolean
}): Uint8Array {
  const { count, centralSize, centralOffset, zip64 } = input
  const size = zip64
    ? ZIP64_EOCD_SIZE + ZIP64_LOCATOR_SIZE + EOCD_SIZE
    : EOCD_SIZE
  const writer = new ByteWriter(new Uint8Array(size))

  if (zip64) {
    writer
      .u32(ZIP64_EOCD_SIG)
      .u64(ZIP64_EOCD_SIZE - 12) // размер записи без подписи и самого поля
      .u16(VERSION_ZIP64)
      .u16(VERSION_ZIP64)
      .u32(0) // номер диска
      .u32(0) // диск с описью
      .u64(count)
      .u64(count)
      .u64(centralSize)
      .u64(centralOffset)
      .u32(ZIP64_LOCATOR_SIG)
      .u32(0) // диск с ZIP64 EOCD
      .u64(centralOffset + centralSize)
      .u32(1) // всего дисков
  }

  writer
    .u32(EOCD_SIG)
    .u16(0)
    .u16(0)
    .u16(zip64 ? U16_MAX : count)
    .u16(zip64 ? U16_MAX : count)
    .u32(zip64 ? U32_MAX : centralSize)
    .u32(zip64 ? U32_MAX : centralOffset)
    .u16(0) // комментарий
  return writer.done()
}

// ─── CRC-32 ──────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  crcTable = table
  return table
}

const CRC_INIT = 0xffffffff

function crcUpdate(crc: number, bytes: Uint8Array, length = bytes.length) {
  const table = getCrcTable()
  let value = crc
  for (let i = 0; i < length; i += 1) {
    value = table[(value ^ bytes[i]!) & 0xff]! ^ (value >>> 8)
  }
  return value >>> 0
}

function crcFinal(crc: number): number {
  return (crc ^ 0xffffffff) >>> 0
}

// ─── поток ───────────────────────────────────────────────────────────────────

export type ZipStreamOptions = {
  layout: ZipLayout
  /** Байты объекта из хранилища. Вызывается по одному объекту за раз. */
  openObject: (s3Key: string) => Promise<ReadableStream<Uint8Array>>
  /**
   * Объект в бакете разошёлся с каталогом по размеру. Поток обязан выдать
   * ровно обещанное число байт, поэтому короткий объект добивается нулями, а
   * длинный обрезается — и о том, и о другом нужно узнать из логов.
   */
  onSizeMismatch?: (
    entry: ZipStreamEntry,
    outcome: { written: number; padded: boolean; truncated: boolean },
  ) => void
}

async function* zipChunks(
  options: ZipStreamOptions,
): AsyncGenerator<Uint8Array> {
  const { layout, openObject, onSizeMismatch } = options
  const finished: { crc: number; size: number }[] = []

  for (const item of layout.entries) {
    yield localHeader(item)

    if (item.entry.isDir || !item.entry.s3Key) {
      finished.push({ crc: 0, size: 0 })
      continue
    }

    const expected = item.entry.size
    let written = 0
    let truncated = false
    let crc = CRC_INIT

    const reader = (await openObject(item.entry.s3Key)).getReader()
    try {
      while (written < expected) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.length === 0) continue
        const room = expected - written
        const chunk = value.length > room ? value.subarray(0, room) : value
        if (chunk.length < value.length) truncated = true
        crc = crcUpdate(crc, chunk)
        written += chunk.length
        yield chunk
      }
    } finally {
      await reader.cancel().catch(() => {})
    }

    const padded = written < expected
    if (padded) {
      let padding = expected - written
      while (padding > 0) {
        const size = Math.min(padding, PAD_CHUNK.length)
        const chunk = PAD_CHUNK.subarray(0, size)
        crc = crcUpdate(crc, chunk)
        padding -= size
        yield chunk
      }
    }
    if (padded || truncated) {
      onSizeMismatch?.(item.entry, { written, padded, truncated })
    }

    const crcValue = crcFinal(crc)
    finished.push({ crc: crcValue, size: expected })
    yield dataDescriptor(item, crcValue, expected)
  }

  for (const [index, item] of layout.entries.entries()) {
    const result = finished[index]!
    yield centralHeader(item, result.crc, result.size)
  }

  yield endOfCentralDirectory({
    count: layout.entries.length,
    centralSize: layout.centralSize,
    centralOffset: layout.centralOffset,
    zip64: layout.zip64,
  })
}

/**
 * Архив как веб-поток.
 *
 * `pull` вместо `start`: генератор дёргается только когда очередь потока
 * опустела, то есть скорость чтения из R2 определяется скоростью клиента.
 * Иначе двухгигабайтная часть уехала бы в память процесса целиком — pm2
 * перезапускает приложение на 1 ГБ.
 */
export function createZipStream(
  options: ZipStreamOptions,
): ReadableStream<Uint8Array> {
  const chunks = zipChunks(options)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await chunks.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() {
      await chunks.return(undefined).catch(() => {})
    },
  })
}
