export type RemoteComputerDto = {
  id: string
  name: string
  description: string
  status: "idle" | "busy" | "error"
  online: boolean
  currentProjectId: string | null
  currentProjectName: string | null
  currentTask: string | null
  lastHeartbeatAt: string | null
  meta: Record<string, unknown>
  createdBy: string
  createdAt: string
}
