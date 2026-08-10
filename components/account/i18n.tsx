"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

export type Lang = "ru" | "en"

const STORAGE_KEY = "ffworks-lang"

export const dict = {
  ru: {
    langName: "RU",
    langTitle: "Русский",
    workspaceSection: "РАБОЧЕЕ МЕСТО",
    dashboard: "Дашборд",
    projects: "Проекты",
    logout: "Выйти",
    balance: "БАЛАНС",
    topup: "Пополнить",
    renderMinutes: "~ 0 мин рендера",
    projectsHeading: "ПРОЕКТЫ",
    searchProjects: "Поиск проектов…",
    newProject: "Новый проект",
    creatingProject: "Создание…",
    createFailed: "Не удалось создать проект",
    groupShared: "общие",
    groupPersonal: "личные",
    groupTools: "инструменты",
    groupArchive: "архив",
    allProjectsCrumb: "Все проекты",
    yourProjects: "Ваши проекты",
    yourProjectsSub:
      "Создавайте проекты, описывайте бриф и загружайте материалы для генерации.",
    emptyFolder: "Папка пуста — щёлкните правой кнопкой, чтобы загрузить",
    emptyProjects: "Пока нет проектов. Создайте первый.",
    upload: "Загрузить",
    refresh: "Обновить",
    paused: "На паузе",
    projectRoot: "корень проекта",
    tabDesc: "Описание",
    tabSettings: "Настройки",
    tabChat: "Чат",
    tabFiles: "Файлы",
    cancel: "Отмена",
    descHeading: "ОПИСАНИЕ",
    descEmpty: "Описание ещё не добавлено. Опишите бриф этого проекта.",
    createdLabel: "Создан",
    updatedLabel: "Обновлён",
    settingPauseTitle: "Проект на паузе",
    settingPauseDesc:
      "Приостановить обработку. В списке проект отображается блёклым.",
    chatPlaceholder: "Напишите сообщение…",
    chatEmpty:
      "Пока нет сообщений. Расскажите о проекте — команда ответит здесь.",
    openChat: "Открыть чат",
    chat: "Чат",
    statusPaused: "на паузе",
    statusActive: "активен",
    resumeProject: "Возобновить проект",
    pauseProject: "Поставить на паузу",
    sizeLabel: "Размер",
    dateLabel: "Дата",
    previewEmpty: "Выберите файл для превью или откройте папку",
    accountCrumb: "Аккаунт",
    dashboardCrumb: "Дашборд",
    yourWorkspace: "ВАШЕ РАБОЧЕЕ МЕСТО",
    greetingMorning: "Доброе утро",
    greetingAfternoon: "Добрый день",
    greetingEvening: "Добрый вечер",
    heroSub:
      "Управляйте проектами и загружайте исходные материалы для генерации.",
    memberSince: "С нами с",
    allProjects: "Все проекты",
    cardBalance: "БАЛАНС",
    cardProjects: "ПРОЕКТЫ",
    cardClips: "ФАЙЛЫ",
    cardRuntime: "ОБЪЁМ",
    cardProjectsSub: "Всего проектов в workspace",
    cardClipsSub: "За всё время",
    cardRuntimeSub: "Суммарный размер файлов",
    statsTitle: "Статистика загрузок",
    statsSub: "Файлы, загруженные за выбранный период.",
    scopeAll: "Все проекты",
    scopeSel: "Выбранный",
    rangeDays: "Дни",
    rangeWeeks: "Недели",
    rangeMonths: "Месяцы",
    statProcessed: "Загружено за период",
    statProcTime: "Время обработки",
    statRuntime: "Объём",
    statAvg: "Среднее в день",
    shortcutProjectsTitle: "Управлять проектами",
    shortcutProjectsSub:
      "Просматривайте брифы, загружайте файлы, держите всё в порядке.",
    shortcutProfileTitle: "Профиль и безопасность",
    shortcutProfileSub: "Обновите имя, email и пароль.",
    accountSection: "АККАУНТ",
    profileTitle: "Профиль",
    profileSub:
      "Личные данные и настройки безопасности аккаунта FF Works.",
    memberBadge: "Участник",
    adminBadge: "Админ",
    activeBadge: "Активен",
    joined: "Присоединился",
    personalInfo: "Личные данные",
    personalInfoSub: "Обновите имя и email, связанные с аккаунтом.",
    fullName: "Полное имя",
    email: "Email",
    emailHint: "Используется для входа и уведомлений.",
    upToDate: "Всё актуально.",
    reset: "Сбросить",
    saveChanges: "Сохранить",
    changePassword: "Смена пароля",
    changePasswordSub:
      "Выберите надёжный пароль — не меньше 8 символов. Вы останетесь в системе на этом устройстве.",
    currentPassword: "Текущий пароль",
    currentPasswordPh: "Введите текущий пароль",
    newPassword: "Новый пароль",
    newPasswordPh: "Не меньше 8 символов",
    confirmPassword: "Подтвердите пароль",
    confirmPasswordPh: "Повторите новый пароль",
    updatePassword: "Обновить пароль",
    dangerTitle: "Удаление аккаунта",
    dangerSub:
      "Это действие необратимо. Все ваши проекты и файлы будут удалены.",
    deleteAccount: "Удалить аккаунт",
    viewSite: "Открыть сайт",
    viewList: "Список",
    viewGrid: "Сетка",
    viewColumns: "Столбцы",
    mDownload: "Скачать",
    mRename: "Переименовать",
    mShare: "Поделиться",
    mSelect: "Выделить",
    mCopy: "Копировать",
    mMove: "Переместить",
    mDelete: "Удалить",
    mNewFolder: "Создать папку",
    mNewText: "Создать текстовый файл",
    mUploadFile: "Загрузить файл",
    mUploadFolder: "Загрузить папку",
    mOpenWindow: "Открыть в новом окне",
    mOpenDrive: "Открыть файл",
    archiveProject: "В архив",
    deleteProject: "Удалить проект",
    saveDescription: "Сохранить описание",
    folderNamePrompt: "Имя папки",
    renamePrompt: "Новое имя",
    confirmDelete: "Удалить этот элемент?",
    confirmDeleteProject: "Удалить проект безвозвратно?",
    adminPanel: "Админка",
    adminOverview: "Обзор",
    adminContent: "Контент",
    adminPeople: "Люди",
    adminVisitors: "Посетители",
    adminRemoteAccess: "Удалённый доступ",
    adminOverviewEyebrow: "Дашборд",
    adminOverviewTitle: "Обзор студии",
    adminOverviewDesc:
      "Следите за контентом и вносите изменения, не покидая эту страницу.",
    adminOverviewNewVideo: "Новое видео",
    adminOverviewLoading: "Подключаем студию…",
    adminOverviewQuickActions: "Быстрые действия",
    adminContentEyebrow: "Библиотека",
    adminContentTitle: "Контент",
    adminContentDesc:
      "Видео и идеи в одном потоке. Фильтруйте по типу, статусу или категории.",
    adminPeopleEyebrow: "Доступ",
    adminPeopleTitle: "Люди",
    adminPeopleDesc:
      "Создавайте аккаунты, назначайте админов, блокируйте нарушителей.",
    adminPeopleNew: "Новый пользователь",
    adminVisitorsEyebrow: "Аналитика",
    adminVisitorsTitle: "Посетители",
    adminVisitorsDesc:
      "Кто заходил, куда переходил и как часто.",
    adminRemoteEyebrow: "Автоматизация",
    adminRemoteTitle: "Удалённый доступ",
    adminRemoteDesc:
      "Подключайте компьютеры агента: токен для API, статус online и проект в работе.",
    adminRemoteConnect: "Подключить компьютер",
    adminRemoteEmptyTitle: "Нет подключённых компьютеров",
    adminRemoteEmptyDesc:
      "Создайте компьютер и передайте токен в приложение автоматизации.",
    loading: "Загрузка…",
    sending: "Отправка…",
    uploading: "Загрузка…",
    compact: "Компактный",
    cozy: "Простой",
    paneInSub: "Сюда кладите исходные файлы",
    paneOutSub: "Здесь готовые результаты",
    driveUnavailable: "Хранилище недоступно для этого проекта",
    driveEmpty: "Папок пока нет — загрузите файлы или дождитесь синхронизации",
  },
  en: {
    langName: "EN",
    langTitle: "English",
    workspaceSection: "WORKSPACE",
    dashboard: "Dashboard",
    projects: "Projects",
    logout: "Log out",
    balance: "BALANCE",
    topup: "Top up",
    renderMinutes: "~ 0 min of rendering",
    projectsHeading: "PROJECTS",
    searchProjects: "Search projects…",
    newProject: "New project",
    creatingProject: "Creating…",
    createFailed: "Could not create project",
    groupShared: "shared",
    groupPersonal: "personal",
    groupTools: "tools",
    groupArchive: "archive",
    allProjectsCrumb: "All projects",
    yourProjects: "Your projects",
    yourProjectsSub:
      "Create projects, describe the brief, and upload media for generation.",
    emptyFolder: "Folder is empty — right-click to upload",
    emptyProjects: "No projects yet. Create your first one.",
    upload: "Upload",
    refresh: "Refresh",
    paused: "Paused",
    projectRoot: "project root",
    tabDesc: "Description",
    tabSettings: "Settings",
    tabChat: "Chat",
    tabFiles: "Files",
    cancel: "Cancel",
    descHeading: "DESCRIPTION",
    descEmpty: "No description yet. Describe the brief for this project.",
    createdLabel: "Created",
    updatedLabel: "Updated",
    settingPauseTitle: "Project on pause",
    settingPauseDesc:
      "Suspend processing. The project appears dimmed in the list.",
    chatPlaceholder: "Write a message…",
    chatEmpty:
      "No messages yet. Tell us about the project — the team will reply here.",
    openChat: "Open chat",
    chat: "Chat",
    statusPaused: "paused",
    statusActive: "active",
    resumeProject: "Resume project",
    pauseProject: "Pause project",
    sizeLabel: "Size",
    dateLabel: "Date",
    previewEmpty: "Select a file to preview or open a folder",
    accountCrumb: "Account",
    dashboardCrumb: "Dashboard",
    yourWorkspace: "YOUR WORKSPACE",
    greetingMorning: "Good morning",
    greetingAfternoon: "Good afternoon",
    greetingEvening: "Good evening",
    heroSub:
      "Manage your content projects and upload source media for generation.",
    memberSince: "Member since",
    allProjects: "All projects",
    cardBalance: "BALANCE",
    cardProjects: "PROJECTS",
    cardClips: "FILES",
    cardRuntime: "TOTAL SIZE",
    cardProjectsSub: "Total projects in workspace",
    cardClipsSub: "All time",
    cardRuntimeSub: "Combined file size",
    statsTitle: "Upload statistics",
    statsSub: "Files uploaded over the selected period.",
    scopeAll: "All projects",
    scopeSel: "Selected",
    rangeDays: "Days",
    rangeWeeks: "Weeks",
    rangeMonths: "Months",
    statProcessed: "Uploaded in period",
    statProcTime: "Processing time",
    statRuntime: "Size",
    statAvg: "Avg per day",
    shortcutProjectsTitle: "Manage projects",
    shortcutProjectsSub:
      "Review briefs, upload assets, keep everything organised.",
    shortcutProfileTitle: "Profile & security",
    shortcutProfileSub: "Update your name, email and password.",
    accountSection: "ACCOUNT",
    profileTitle: "Profile",
    profileSub:
      "Personal information and security settings for your FF Works account.",
    memberBadge: "Member",
    adminBadge: "Admin",
    activeBadge: "Active",
    joined: "Joined",
    personalInfo: "Personal info",
    personalInfoSub: "Update the name and email associated with your account.",
    fullName: "Full name",
    email: "Email",
    emailHint: "Used for signing in and account notifications.",
    upToDate: "Everything is up to date.",
    reset: "Reset",
    saveChanges: "Save changes",
    changePassword: "Change password",
    changePasswordSub:
      "Pick something strong — at least 8 characters. You will stay signed in on this device.",
    currentPassword: "Current password",
    currentPasswordPh: "Enter your current password",
    newPassword: "New password",
    newPasswordPh: "At least 8 characters",
    confirmPassword: "Confirm new password",
    confirmPasswordPh: "Repeat the new password",
    updatePassword: "Update password",
    dangerTitle: "Delete account",
    dangerSub:
      "This action is irreversible. All your projects and files will be removed.",
    deleteAccount: "Delete account",
    viewSite: "View site",
    viewList: "List",
    viewGrid: "Grid",
    viewColumns: "Columns",
    mDownload: "Download",
    mRename: "Rename",
    mShare: "Share",
    mSelect: "Select",
    mCopy: "Copy",
    mMove: "Move",
    mDelete: "Delete",
    mNewFolder: "New folder",
    mNewText: "New text file",
    mUploadFile: "Upload file",
    mUploadFolder: "Upload folder",
    mOpenWindow: "Open in new window",
    mOpenDrive: "Open file",
    archiveProject: "Archive",
    deleteProject: "Delete project",
    saveDescription: "Save description",
    folderNamePrompt: "Folder name",
    renamePrompt: "New name",
    confirmDelete: "Delete this item?",
    confirmDeleteProject: "Delete this project permanently?",
    adminPanel: "Admin",
    adminOverview: "Overview",
    adminContent: "Content",
    adminPeople: "People",
    adminVisitors: "Visitors",
    adminRemoteAccess: "Remote access",
    adminOverviewEyebrow: "Dashboard",
    adminOverviewTitle: "Studio overview",
    adminOverviewDesc:
      "Track your content health and ship updates without leaving this page.",
    adminOverviewNewVideo: "New video",
    adminOverviewLoading: "Bringing your studio online…",
    adminOverviewQuickActions: "Quick actions",
    adminContentEyebrow: "Library",
    adminContentTitle: "Content",
    adminContentDesc:
      "Videos and ideas in one curated stream. Filter by type, status or category.",
    adminPeopleEyebrow: "Access",
    adminPeopleTitle: "People",
    adminPeopleDesc:
      "Provision accounts, promote admins, suspend abusers.",
    adminPeopleNew: "New person",
    adminVisitorsEyebrow: "Insights",
    adminVisitorsTitle: "Visitors",
    adminVisitorsDesc:
      "Who walked through the door, where they went, and how often.",
    adminRemoteEyebrow: "Automation",
    adminRemoteTitle: "Remote access",
    adminRemoteDesc:
      "Connect agent computers: API token, online status, and active project.",
    adminRemoteConnect: "Connect computer",
    adminRemoteEmptyTitle: "No computers connected",
    adminRemoteEmptyDesc:
      "Create a computer and pass the token to the automation app.",
    loading: "Loading…",
    sending: "Sending…",
    uploading: "Uploading…",
    compact: "Compact",
    cozy: "Simple",
    paneInSub: "Drop your source files here",
    paneOutSub: "Pick up finished results here",
    driveUnavailable: "Storage is unavailable for this project",
    driveEmpty: "No folders yet — upload files or wait for sync",
  },
} as const

export type DictKey = keyof typeof dict.ru
export type Dictionary = (typeof dict)[Lang]

type I18nCtx = {
  lang: Lang
  t: Dictionary
  setLang: (lang: Lang) => void
}

const Ctx = createContext<I18nCtx | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru")

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === "ru" || stored === "en") setLangState(stored)
    } catch {
      // ignore
    }
  }, [])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])

  const value = useMemo(
    () => ({ lang, t: dict[lang], setLang }),
    [lang, setLang],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useI18n() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}

export function formatBalance(cents: number, lang: Lang): string {
  const value = cents / 100
  return new Intl.NumberFormat(lang === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

export function avatarInitials(name: string, email: string): string {
  const source = name.trim() || email.trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toLocaleUpperCase()
  }
  return (source.match(/\p{L}/u)?.[0] ?? source[0] ?? "?").toLocaleUpperCase()
}

export function greetingForHour(hour: number, t: Dictionary): string {
  if (hour < 12) return t.greetingMorning
  if (hour < 18) return t.greetingAfternoon
  return t.greetingEvening
}
