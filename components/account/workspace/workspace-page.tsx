"use client"

import { ClipboardPanel } from "./clipboard-panel"
import { WorkspaceContextMenu } from "./context-menu"
import { FullMode } from "./full-mode"
import { MobileWorkspace } from "./mobile-view"
import { MoveDialog } from "./move-dialog"
import { ProjectsColumn } from "./projects-column"
import { AllProjectsPage, SimpleProject } from "./simple-mode"
import { WorkspaceProvider, useWorkspace } from "./workspace-context"
import { WorkspaceDialogs } from "./workspace-dialogs"
import { WorkspaceTopbar } from "./workspace-topbar"

function WorkspaceLayout() {
  const { density, selected } = useWorkspace()

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      {/* Десктоп: колонка проектов (только полный режим) + рабочая область */}
      <div className="hidden h-full min-w-0 flex-1 lg:flex">
        {density === "full" ? <ProjectsColumn /> : null}
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <WorkspaceTopbar />
          {density === "full" ? (
            <FullMode />
          ) : selected ? (
            <SimpleProject />
          ) : (
            <AllProjectsPage />
          )}
        </main>
      </div>

      {/* Мобильный: одна колонка, навигация через нижние табы */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
        <WorkspaceTopbar />
        <MobileWorkspace />
      </main>

      <ClipboardPanel />
      <WorkspaceContextMenu />
      <MoveDialog />
      <WorkspaceDialogs />
    </div>
  )
}

export function WorkspacePageClient() {
  return (
    <WorkspaceProvider>
      <WorkspaceLayout />
    </WorkspaceProvider>
  )
}
