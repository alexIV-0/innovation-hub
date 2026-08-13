import { NextResponse } from "next/server"

export const runtime = "nodejs"

const gone = () =>
  NextResponse.json(
    {
      message:
        "This endpoint was replaced by POST /api/v1 with { action: \"me\", props: {}, token }.",
    },
    { status: 410 },
  )

export async function GET() {
  return gone()
}

export async function POST() {
  return gone()
}
