"use client"

import { useI18n, type Lang } from "@/components/account/i18n"

/**
 * Словарь редактора и просмотрщика описания.
 *
 * Отдельный, а не в `components/account/i18n.tsx`, по той же причине, по которой
 * у админки свой `admin-dict.ts`: это ~60 подписей одного узла (тулбар, палитра,
 * диалоги вставки), они нужны обеим зонам и не имеют смысла нигде больше.
 * Провайдер языка общий — `useI18n`.
 *
 * Часть подписей попадает В ФАЙЛ, а не в интерфейс: `detailsSummary` и
 * `tableColumn` — это текст, который кнопка пишет в описание. Они здесь потому,
 * что автор пишет описание на своём языке.
 */
export const mdDict = {
  ru: {
    // история
    undo: "Отменить (⌘/Ctrl+Z)",
    redo: "Вернуть (⌘⇧Z / Ctrl+Y)",

    // символ
    bold: "Жирный (⌘/Ctrl+B)",
    italic: "Курсив (⌘/Ctrl+I)",
    underline: "Подчёркнутый (⌘/Ctrl+U)",
    strike: "Зачёркнутый",
    textColor: "Цвет текста",
    fillColor: "Заливка фона",
    inlineCode: "Инлайн-код (⌘/Ctrl+E)",
    clearFormat: "Убрать форматирование",

    // абзац
    paragraphStyle: "Стиль абзаца",
    normalText: "Обычный текст",
    heading: "Заголовок {level}",
    indentParagraph: "Красная строка",
    alignment: "Выравнивание",
    alignLeft: "По левому краю",
    alignCenter: "По центру",
    alignRight: "По правому краю",
    alignJustify: "По ширине",
    quote: "Цитата",
    hr: "Разделитель",
    details: "Спойлер",

    // списки
    bulletList: "Список",
    orderedList: "Нумерованный список",
    checkList: "Чеклист",
    indentMore: "Увеличить отступ (Tab)",
    indentLess: "Уменьшить отступ (⇧Tab)",

    // вставка
    link: "Ссылка (⌘/Ctrl+K)",
    image: "Картинка — файлом, вставкой из буфера или перетаскиванием",
    table: "Таблица",
    codeBlock: "Блок кода",
    mermaid: "Блок-схема (mermaid)",
    emoji: "Эмодзи",

    // вид
    fontSizeTitle: "Размер текста: {size} px",
    viewRich: "Правка в обычном виде",
    viewSplit: "Текст и превью",
    viewText: "Только текст",
    viewPreview: "Только превью",
    narrowOn: "Ширина: узкий экран",
    narrowOff: "Ширина: широкий экран",

    // палитра
    hueBlue: "синий",
    hueGreen: "зелёный",
    hueOrange: "оранжевый",
    hueRed: "красный",
    hueYellow: "жёлтый",
    hueTeal: "бирюзовый",
    huePurple: "фиолетовый",
    hueCyan: "голубой",
    huePink: "розовый",
    hueMuted: "серый",
    toneStrong: "насыщенный",
    toneMedium: "средний",
    toneSoft: "мягкий",
    grayScale: "Серая шкала",
    gray0: "белый",
    gray1: "светло-серый",
    gray2: "серый",
    gray3: "тёмно-серый",
    gray4: "почти чёрный",
    gray5: "чёрный",
    clearTextColor: "Убрать цвет",
    clearFillColor: "Убрать заливку",

    // диалоги вставки
    linkTitle: "Ссылка",
    linkTextLabel: "Текст",
    linkUrlLabel: "Адрес",
    tableTitle: "Таблица",
    tableCols: "Столбцов",
    tableRows: "Строк",
    tableHeader: "Шапка",
    codeTitle: "Блок кода",
    codeLangLabel: "Язык",
    insert: "Вставить",
    cancel: "Отмена",

    // редактор
    editorPlaceholder:
      "Описание проекта. Здесь виден сам markdown — тот же текст, что лежит в options/description.md.",
    imageBusy: "обработка картинки…",
    imageFailed: "Не удалось вставить картинку",
    sizeWarn: "больше 2 МБ — уменьшите картинки, файл едет целиком на каждое сохранение",

    // то, что кнопка пишет в файл
    detailsSummary: "Подробности",
    tableColumn: "Столбец {index}",
  },
  en: {
    undo: "Undo (⌘/Ctrl+Z)",
    redo: "Redo (⌘⇧Z / Ctrl+Y)",

    bold: "Bold (⌘/Ctrl+B)",
    italic: "Italic (⌘/Ctrl+I)",
    underline: "Underline (⌘/Ctrl+U)",
    strike: "Strikethrough",
    textColor: "Text colour",
    fillColor: "Highlight",
    inlineCode: "Inline code (⌘/Ctrl+E)",
    clearFormat: "Clear formatting",

    paragraphStyle: "Paragraph style",
    normalText: "Normal text",
    heading: "Heading {level}",
    indentParagraph: "First-line indent",
    alignment: "Alignment",
    alignLeft: "Align left",
    alignCenter: "Align centre",
    alignRight: "Align right",
    alignJustify: "Justify",
    quote: "Quote",
    hr: "Divider",
    details: "Spoiler",

    bulletList: "Bulleted list",
    orderedList: "Numbered list",
    checkList: "Checklist",
    indentMore: "Increase indent (Tab)",
    indentLess: "Decrease indent (⇧Tab)",

    link: "Link (⌘/Ctrl+K)",
    image: "Image — pick a file, paste or drop it",
    table: "Table",
    codeBlock: "Code block",
    mermaid: "Diagram (mermaid)",
    emoji: "Emoji",

    fontSizeTitle: "Text size: {size} px",
    viewRich: "Rich editing",
    viewSplit: "Source and preview",
    viewText: "Source only",
    viewPreview: "Preview only",
    narrowOn: "Width: narrow screen",
    narrowOff: "Width: wide screen",

    hueBlue: "blue",
    hueGreen: "green",
    hueOrange: "orange",
    hueRed: "red",
    hueYellow: "yellow",
    hueTeal: "teal",
    huePurple: "purple",
    hueCyan: "cyan",
    huePink: "pink",
    hueMuted: "grey",
    toneStrong: "strong",
    toneMedium: "medium",
    toneSoft: "soft",
    grayScale: "Grey scale",
    gray0: "white",
    gray1: "light grey",
    gray2: "grey",
    gray3: "dark grey",
    gray4: "near black",
    gray5: "black",
    clearTextColor: "Remove colour",
    clearFillColor: "Remove highlight",

    linkTitle: "Link",
    linkTextLabel: "Text",
    linkUrlLabel: "URL",
    tableTitle: "Table",
    tableCols: "Columns",
    tableRows: "Rows",
    tableHeader: "Header row",
    codeTitle: "Code block",
    codeLangLabel: "Language",
    insert: "Insert",
    cancel: "Cancel",

    editorPlaceholder:
      "Project description. This is the markdown itself — the same text that lives in options/description.md.",
    imageBusy: "processing image…",
    imageFailed: "Could not insert the image",
    sizeWarn: "over 2 MB — shrink the images, the whole file is uploaded on every save",

    detailsSummary: "Details",
    tableColumn: "Column {index}",
  },
} satisfies Record<Lang, Record<string, string>>

export type MdDict = (typeof mdDict)["ru"]

export function useMdDict(): MdDict {
  const { lang } = useI18n()
  return mdDict[lang]
}
