import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { PipelineContent } from "@/components/admin/pipeline/pipeline-content"

export const dynamic = "force-dynamic"

export default async function AdminPipelinePage() {
  await requireCapabilityPage("pipeline.operate")

  return <PipelineContent />
}
