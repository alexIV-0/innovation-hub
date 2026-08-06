import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteFileCascade,
  findFileById,
} from "@/lib/repositories/project-files"
import { findProjectForUser } from "@/lib/repositories/projects"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; mediaId: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, mediaId } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const file = await findFileById(mediaId)
  if (!file || file.projectId !== project.id || file.isFolder) {
    return NextResponse.json({ message: "Media not found." }, { status: 404 })
  }

  const { deletedS3Keys } = await deleteFileCascade(mediaId, project.id)

  if (deletedS3Keys.length > 0 && isS3Configured()) {
    const client = getS3Client()
    const bucket = getS3Bucket()
    await Promise.allSettled(
      deletedS3Keys.map((key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
      ),
    )
  }

  return NextResponse.json({ ok: true })
}
