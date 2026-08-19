/**
 * Проверка совместимости рендерера описания с контрактом
 * (docs/DESCRIPTION_FORMAT.md §10).
 *
 * Гоняет эталонный `docs/description.example.md` через тот же конвейер и ту же
 * схему санитайза, что и сайт, и смотрит, что дошло до разметки. Плюс отдельный
 * враждебный образец — что НЕ дошло, и отдельный прогон сериализатора — что
 * пишет в файл правка «как выглядит». Расширяете контракт — сначала дописываете
 * пример, потом сюда.
 *
 * Usage:
 *   npm run md:check
 *
 * Почему .mts: скрипт импортирует настоящую схему из `lib/markdown`, а не свою
 * копию — копия разъехалась бы с рендерером, и проверка стала бы врать.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import type { Element, Node, Parent, Root } from "hast"

import { descriptionSanitizeSchema } from "../lib/markdown/description-format.ts"
import {
  docToMarkdown,
  type DocNode,
} from "../lib/markdown/markdown-serialize.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Порядок плагинов тот же, что в components/markdown/markdown-view.tsx. */
const pipeline = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, descriptionSanitizeSchema)

function render(markdown: string): Root {
  return pipeline.runSync(pipeline.parse(markdown)) as Root
}

interface Seen {
  tags: Set<string>
  classes: Set<string>
  attrs: Set<string>
  urls: string[]
  text: string
}

function collect(node: Node, seen: Seen): Seen {
  if (node.type === "element") {
    const el = node as Element
    seen.tags.add(el.tagName)
    for (const [name, value] of Object.entries(el.properties ?? {})) {
      seen.attrs.add(`${el.tagName}.${name}`)
      if (name === "className") {
        for (const cls of Array.isArray(value) ? value : [value]) {
          seen.classes.add(String(cls))
        }
      }
      if (name === "src" || name === "href") seen.urls.push(String(value))
    }
  }
  if (node.type === "text") seen.text += (node as { value: string }).value
  for (const child of (node as Parent).children ?? []) collect(child, seen)
  return seen
}

function scan(markdown: string): Seen {
  return collect(render(markdown), {
    tags: new Set(),
    classes: new Set(),
    attrs: new Set(),
    urls: [],
    text: "",
  })
}

let failures = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${name}`)
    return
  }
  failures += 1
  console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`)
}

// ─── 1. Эталонный файл: всё разрешённое должно дойти ────────────────────────

const example = readFileSync(join(root, "docs/description.example.md"), "utf8")
const got = scan(example)

console.log("\ndocs/description.example.md — разрешённое доходит:")

const REQUIRED_TAGS = [
  "h1", "h2", "h3", "h4",
  "p", "strong", "em", "del", "u", "mark", "code", "pre",
  "ul", "ol", "li", "input",
  "blockquote", "hr", "a", "br",
  "table", "thead", "tbody", "tr", "th", "td",
  "img", "details", "summary", "div", "span",
]
for (const tag of REQUIRED_TAGS) {
  check(`тег <${tag}>`, got.tags.has(tag))
}

const REQUIRED_CLASSES = [
  "fg-blue", "fg-blue-2", "fg-blue-3",
  "fg-green", "fg-orange", "fg-red", "fg-yellow",
  "fg-teal", "fg-purple", "fg-cyan", "fg-pink", "fg-muted",
  "fg-gray-0", "fg-gray-5",
  "bg-yellow", "bg-teal", "bg-red", "bg-gray-0",
  "align-center", "align-right", "align-justify",
  "indent",
  "contains-task-list", "task-list-item",
  "language-ts", "language-mermaid", "language-someUnknownLang",
]
for (const cls of REQUIRED_CLASSES) {
  check(`класс .${cls}`, got.classes.has(cls))
}

check("чеклист: input[checked]", got.attrs.has("input.checked"))
check(
  "встроенная картинка data:image",
  got.urls.some((url) => url.startsWith("data:image/")),
)
check(
  "внешняя ссылка сохранилась",
  got.urls.some((url) => url.startsWith("https://example.com")),
)

// ─── 2. Чего в эталоне нет ──────────────────────────────────────────────────

/**
 * Выравнивание колонок GFM (`|:---:|`) в `description.example.md` не
 * задействовано: там все таблицы с `|---|`, а это `align: null`, то есть
 * атрибута в разметке не появляется вообще. Случай важный (контракт §7 держит
 * для него точечное разрешение `align` на th/td при общем запрете `style`),
 * поэтому проверяется своим образцом. Дописать его в эталон стоит сразу в двух
 * репозиториях — так требует §10.
 */
const aligned = scan(
  [
    "| левый | центр | правый |",
    "|:---|:---:|---:|",
    "| a | b | c |",
  ].join("\n"),
)

console.log("\nвыравнивание колонок таблицы (нет в эталоне):")
check("align на th", aligned.attrs.has("th.align"))
check("align на td", aligned.attrs.has("td.align"))
check(
  "style у ячейки не появился",
  !aligned.attrs.has("th.style") && !aligned.attrs.has("td.style"),
)

// ─── 3. Враждебный образец: всё запрещённое должно быть вырезано ────────────

const hostile = [
  '<script>alert(1)</script>',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="x"></object><embed src="x">',
  '<form><input type="text"></form>',
  '<p style="color:red" id="x" onclick="alert(1)">текст со style</p>',
  '<img src="x.png" width="900" height="900" alt="жёсткие размеры">',
  '<span class="fg-chartreuse">чужое имя цвета</span>',
  '<span class="fg-blue extra-class">лишний класс рядом с разрешённым</span>',
  '<div class="align-middle">чужое выравнивание</div>',
  '<p class="hero">чужой класс абзаца</p>',
  '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="не картинка">',
  '<a href="javascript:alert(1)">опасная ссылка</a>',
].join("\n\n")

const blocked = scan(hostile)

console.log("\nвраждебный образец — запрещённое вырезано:")

for (const tag of ["script", "iframe", "object", "embed", "form"]) {
  check(`тег <${tag}> вырезан`, !blocked.tags.has(tag))
}
for (const attr of ["p.style", "p.id", "p.onClick", "img.width", "img.height"]) {
  check(`атрибут ${attr} вырезан`, !blocked.attrs.has(attr))
}
for (const cls of ["fg-chartreuse", "extra-class", "align-middle", "hero"]) {
  check(`класс .${cls} вырезан`, !blocked.classes.has(cls))
}
check("fg-blue рядом с чужим классом уцелел", blocked.classes.has("fg-blue"))
check(
  "data:text/html вырезан",
  !blocked.urls.some((url) => url.startsWith("data:text/html")),
)
check(
  "javascript: вырезан",
  !blocked.urls.some((url) => url.toLowerCase().startsWith("javascript:")),
)
// Текст обязан остаться читаемым: санитайз снимает разметку, а не содержимое.
check("текст остался", blocked.text.includes("текст со style"))

// ─── 4. Сериализатор: что правка «как выглядит» пишет в файл ────────────────

/**
 * Единственное место, которое пишет в файл из режима правки документом, —
 * `docToMarkdown`. Значит, оно же обязано соблюдать контракт: закрытый набор
 * тегов, ни одного `style`/`width`, классы палитры вместо цветов, пустые строки
 * вокруг блочных обёрток.
 *
 * Полный круг (md → html → документ → md) здесь не гоняется: сборка документа
 * живёт в браузере, ей нужен DOM. Проверяется половина, которая пишет в файл, —
 * от неё зависит, что увидит программа.
 */
const text = (value: string, marks?: DocNode["marks"]): DocNode =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value }

const doc: DocNode = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 2, align: "center" },
      content: [text("Заголовок по центру")],
    },
    { type: "paragraph", attrs: { indent: true }, content: [text("Красная строка.")] },
    {
      type: "paragraph",
      content: [
        text("жирный", [{ type: "bold" }]),
        text(" и "),
        text("цветной", [
          { type: "textColor", attrs: { fg: "blue", bg: "yellow" } },
        ]),
        text(" и "),
        text("ссылка", [
          { type: "link", attrs: { href: "https://example.com" } },
        ]),
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true },
          content: [{ type: "paragraph", content: [text("сделано")] }],
        },
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph", content: [text("не сделано")] }],
        },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              attrs: { align: "center" },
              content: [{ type: "paragraph", content: [text("центр")] }],
            },
            {
              type: "tableHeader",
              attrs: { align: "right" },
              content: [{ type: "paragraph", content: [text("справа")] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [text("a")] }],
            },
            {
              type: "tableCell",
              content: [{ type: "paragraph", content: [text("b")] }],
            },
          ],
        },
      ],
    },
    {
      type: "details",
      content: [
        { type: "detailsSummary", content: [text("Подробности")] },
        { type: "paragraph", content: [text("скрытый текст")] },
      ],
    },
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [text("flowchart LR\n  A --> B")],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "image",
          attrs: { src: "data:image/png;base64,iVBORw0KGgo=", alt: "картинка" },
        },
      ],
    },
  ],
}

const written = docToMarkdown(doc, { detailsSummary: "Details" })
const back = scan(written)

console.log("\nсериализатор правки «как выглядит» — пишет по контракту:")

check("заголовок с выравниванием", back.classes.has("align-center"))
check("красная строка", back.classes.has("indent"))
check("цвет текста классом", back.classes.has("fg-blue"))
check("заливка классом", back.classes.has("bg-yellow"))
check("ссылка уцелела", back.urls.includes("https://example.com"))
check("чеклист", back.classes.has("contains-task-list"))
check("отмеченный пункт", back.attrs.has("input.checked"))
check("выравнивание колонок", back.attrs.has("th.align"))
check("спойлер", back.tags.has("details") && back.tags.has("summary"))
check("фенс mermaid", back.classes.has("language-mermaid"))
check(
  "картинка осталась внутри файла",
  back.urls.some((url) => url.startsWith("data:image/")),
)
check(
  "ни одного style/width/height",
  ![...back.attrs].some((attr) => /\.(style|width|height)$/.test(attr)),
)
check(
  "блочная обёртка с пустыми строками",
  /<div class="align-center">\n\n/.test(written) &&
    /\n\n<\/div>/.test(written),
)
// Второй прогон обязан дать тот же текст: иначе каждое открытие описания
// переписывало бы файл, и программа видела бы бесконечные «изменения».
check(
  "текст не «плывёт» при повторной записи",
  docToMarkdown(doc, { detailsSummary: "Details" }) === written,
)

// ─── 5. Известный предел: разметка внутри красной строки ────────────────────

/**
 * Красная строка пишется как `<p class="indent">…</p>`, а `<p>` в начале строки
 * CommonMark считает БЛОКОМ HTML — markdown внутри него уже не разбирается.
 * Поэтому абзац с красной строкой и жирным словом сохраняется, а открывается со
 * звёздочками в тексте. Это касается и программы: сериализатор общий.
 *
 * Проверка фиксирует поведение как оно есть, а не притворяется, что его нет:
 * почините — она упадёт и заставит обновить и её, и контракт. Лечится блочной
 * обёрткой с пустыми строками (`<div class="indent">`, как у выравнивания), а
 * это правка формата: схема санитайза, `prepareHtml`, эталонный файл и оба
 * репозитория (docs/DESCRIPTION_FORMAT.md §10).
 */
const indented = docToMarkdown(
  {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { indent: true },
        content: [text("жирный", [{ type: "bold" }]), text(" хвост")],
      },
    ],
  },
  { detailsSummary: "Details" },
)
const indentedBack = scan(indented)

console.log("\nизвестный предел формата (не ошибка проверки):")
check(
  "красная строка: разметка внутри остаётся текстом",
  !indentedBack.tags.has("strong") && indentedBack.text.includes("**жирный**"),
)

console.log(
  failures === 0
    ? "\nописание: рендерер соответствует контракту.\n"
    : `\nописание: расхождений с контрактом — ${failures}.\n`,
)
process.exit(failures === 0 ? 0 : 1)
