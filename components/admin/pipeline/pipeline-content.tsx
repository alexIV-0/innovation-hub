"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { useAdminI18n } from "@/components/admin/admin-dict"
import { ClipboardPanel } from "@/components/account/workspace/clipboard-panel"
import { WorkspaceContextMenu } from "@/components/account/workspace/context-menu"
import { PreviewDialog } from "@/components/account/workspace/file-preview"
import { FullMode } from "@/components/account/workspace/full-mode"
import { ProjectsColumn } from "@/components/account/workspace/projects-column"
import { ShareDialog } from "@/components/account/workspace/share-dialog"
import { WorkspaceDialogs } from "@/components/account/workspace/workspace-dialogs"
import { WorkspaceProvider } from "@/components/account/workspace/workspace-context"
import { createPipelineSource } from "./pipeline-source"
import { PipelineRunBar } from "./pipeline-run-bar"
import { UsersColumn, type PipelineUserDto } from "./users-column"

/**
 * Страница «Конвейер»: три колонки (пользователи → проекты → файлы) и нижняя
 * панель с описанием, настройками и чатом.
 *
 * Колонки 2 и 3 — те же компоненты, что в кабинете пользователя; отличается
 * только источник данных (createPipelineSource). Своя раскладка, а не
 * WorkspacePageClient, потому что здесь не нужен ни упрощённый режим, ни
 * мобильная навигация по табам: админский вид всегда полный и трёхколоночный.
 */
function PipelineLayout({
  users,
  loadingUsers,
  selectedUserId,
  onSelectUser,
  onToggleUser,
}: {
  users: PipelineUserDto[]
  loadingUsers: boolean
  selectedUserId: string | null
  onSelectUser: (userId: string) => void
  onToggleUser: (userId: string, enabled: boolean) => void
}) {
  const t = useAdminI18n()

  return (
    // Колонки сверху, полоса запуска снизу на всю ширину страницы — она
    // управляет слежением по всем пользователям, а не тем, что выбрано в
    // колонках, поэтому и не должна жить внутри одной из них.
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <div className="hidden min-h-0 flex-1 lg:flex">
        <UsersColumn
          users={users}
          loading={loadingUsers}
          selectedUserId={selectedUserId}
          onSelectUser={onSelectUser}
          onToggle={onToggleUser}
        />
        <ProjectsColumn />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <FullMode />
        </main>
      </div>

      {/* Три колонки на телефоне не помещаются, а урезанный вид админке не
          нужен: обработкой управляют с рабочего места. */}
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-[14px] text-ws-4 lg:hidden">
        {t.pipelineNarrowScreen}
      </div>

      <PipelineRunBar />

      <ClipboardPanel />
      <WorkspaceContextMenu />
      <PreviewDialog />
      <ShareDialog />
      <WorkspaceDialogs />
    </div>
  )
}

export function PipelineContent() {
  const t = useAdminI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [users, setUsers] = useState<PipelineUserDto[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)

  /**
   * Выбранный пользователь живёт в URL, как и раздел проектов в кабинете:
   * ссылка на конкретного пользователя переживает перезагрузку и её можно
   * переслать.
   */
  const selectedUserId = searchParams.get("user")

  useEffect(() => {
    void (async () => {
      setLoadingUsers(true)
      try {
        const res = await fetch("/api/admin/pipeline/users")
        if (!res.ok) {
          toast.error(t.pipelineUsersLoadError)
          return
        }
        const data = await res.json()
        setUsers(data.users ?? [])
      } finally {
        setLoadingUsers(false)
      }
    })()
  }, [])

  const onSelectUser = useCallback(
    (userId: string) => {
      // Меняя пользователя, сбрасываем выбранный проект: он принадлежал другому.
      const params = new URLSearchParams()
      params.set("user", userId)
      router.replace(`/admin/pipeline?${params.toString()}`, { scroll: false })
    },
    [router],
  )

  const onToggleUser = useCallback((userId: string, enabled: boolean) => {
    setUsers((prev) =>
      prev.map((u) =>
        u.id === userId ? { ...u, automationEnabled: enabled } : u,
      ),
    )
  }, [])

  const source = useMemo(
    () => createPipelineSource(selectedUserId),
    [selectedUserId],
  )

  return (
    <WorkspaceProvider source={source}>
      <PipelineLayout
        users={users}
        loadingUsers={loadingUsers}
        selectedUserId={selectedUserId}
        onSelectUser={onSelectUser}
        onToggleUser={onToggleUser}
      />
    </WorkspaceProvider>
  )
}
