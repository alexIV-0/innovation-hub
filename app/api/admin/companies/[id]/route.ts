import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  deleteCompany,
  findCompanyById,
  setCompanyActive,
} from "@/lib/repositories/companies"

export const runtime = "nodejs"

const patchSchema = z.object({ isActive: z.boolean() })

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid payload." }, { status: 400 })
  }

  const company = await setCompanyActive(id, parsed.data.isActive)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  await auditFrom(request, auth)({
    action: parsed.data.isActive ? "company.enabled" : "company.disabled",
    targetType: "company",
    targetId: company.id,
    targetLabel: company.title,
    companyId: company.id,
  })

  return NextResponse.json(company)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "companies.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const company = await findCompanyById(id)
  if (!company) {
    return NextResponse.json({ message: "Company not found." }, { status: 404 })
  }

  const result = await deleteCompany(id)
  if (!result.ok) {
    const messages: Record<string, string> = {
      "has-members": "Move all people out of this company before deleting it.",
      "wallet-has-ledger":
        "This company's wallet has money history. Deleting it would erase the ledger.",
      "wallet-has-dependents":
        "This company's wallet still pays for someone. Reassign them first.",
      "not-found": "Company not found.",
    }
    return NextResponse.json(
      { message: messages[result.reason], code: result.reason },
      { status: result.reason === "not-found" ? 404 : 409 },
    )
  }

  await auditFrom(request, auth)({
    action: "company.deleted",
    targetType: "company",
    targetId: id,
    targetLabel: company.title,
  })

  return NextResponse.json({ message: "Company deleted." })
}
