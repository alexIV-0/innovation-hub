import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  deleteTagSuggestion,
  listTagSuggestions,
  upsertTagSuggestion,
} from "@/lib/repositories/tag-suggestions"
import {
  tagSuggestionDeleteSchema,
  tagSuggestionScopeSchema,
  tagSuggestionUpsertSchema,
} from "@/lib/tag-suggestion-schemas"

export async function GET(request: NextRequest) {
  const scopeRaw = request.nextUrl.searchParams.get("scope")
  const q = request.nextUrl.searchParams.get("q") ?? undefined
  const parsedScope = tagSuggestionScopeSchema.safeParse(scopeRaw)
  if (!parsedScope.success) {
    return NextResponse.json({ message: "Invalid scope." }, { status: 400 })
  }

  try {
    const items = await listTagSuggestions({
      fieldScope: parsedScope.data,
      q,
    })
    return NextResponse.json({ items })
  } catch (error) {
    console.error("[api/tag-suggestions] GET", error)
    return NextResponse.json(
      { message: "Could not load suggestions." },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = tagSuggestionUpsertSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const item = await upsertTagSuggestion({
      fieldScope: parsed.data.scope,
      value: parsed.data.value,
    })
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof Error && error.message === "EMPTY_TAG_VALUE") {
      return NextResponse.json({ message: "Value cannot be empty." }, { status: 400 })
    }
    console.error("[api/tag-suggestions] POST", error)
    return NextResponse.json(
      { message: "Could not save suggestion." },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = tagSuggestionDeleteSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const removed = await deleteTagSuggestion({
      fieldScope: parsed.data.scope,
      value: parsed.data.value,
    })
    if (!removed) {
      return NextResponse.json({ message: "Suggestion not found." }, { status: 404 })
    }
    return NextResponse.json({ message: "Removed." })
  } catch (error) {
    console.error("[api/tag-suggestions] DELETE", error)
    return NextResponse.json(
      { message: "Could not delete suggestion." },
      { status: 500 },
    )
  }
}
