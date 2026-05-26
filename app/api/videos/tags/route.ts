import { NextResponse } from "next/server"
import { listPublishedVideoTagCounts } from "@/lib/repositories/videos"

export const runtime = "nodejs"

export async function GET() {
  try {
    const tags = await listPublishedVideoTagCounts()
    return NextResponse.json({ tags })
  } catch (error) {
    console.error("[api/videos/tags] GET", error)
    return NextResponse.json(
      { message: "Could not load tags." },
      { status: 500 },
    )
  }
}
