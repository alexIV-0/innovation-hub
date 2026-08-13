import { RemoteApiDocs } from "@/components/admin/remote-access/remote-api-docs"
import { RemoteApiPageHeader } from "@/components/admin/remote-access/remote-api-page-header"

export const dynamic = "force-dynamic"

export default function AdminRemoteApiPage() {
  return (
    <div className="space-y-8">
      <RemoteApiPageHeader />
      <RemoteApiDocs />
    </div>
  )
}
