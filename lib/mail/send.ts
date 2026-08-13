import { Resend } from "resend"
import { getPublicSiteUrl } from "@/lib/public-site-url"

function siteBase(): string {
  return getPublicSiteUrl() ?? "https://ffworks.pro"
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) return null
  return new Resend(key)
}

function fromAddress(): string {
  return (
    process.env.RESEND_FROM?.trim() ||
    "InnoHub <onboarding@resend.dev>"
  )
}

export type MailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string }

async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
}): Promise<MailResult> {
  const resend = getResend()
  if (!resend) {
    console.warn("[mail] RESEND_API_KEY not set; skipping send to", input.to)
    return { ok: false, error: "Email is not configured." }
  }
  try {
    const result = await resend.emails.send({
      from: fromAddress(),
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    })
    if (result.error) {
      console.error("[mail] send failed", result.error)
      return { ok: false, error: result.error.message }
    }
    return { ok: true, id: result.data?.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Send failed."
    console.error("[mail] send failed", error)
    return { ok: false, error: message }
  }
}

export async function sendProjectAccessGrantedEmail(input: {
  to: string
  inviteeName: string
  projectName: string
  role: "viewer" | "editor"
  inviterName: string
}): Promise<MailResult> {
  const site = siteBase()
  const roleLabel = input.role === "editor" ? "editor" : "viewer"
  const subject = `Access to “${input.projectName}”`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} shared the project “${input.projectName}” with you as ${roleLabel}.`,
    ``,
    `Open your shared projects: ${site}/account/projects?tab=shared`,
  ].join("\n")
  const html = `<p>Hi ${escapeHtml(input.inviteeName)},</p>
<p>${escapeHtml(input.inviterName)} shared the project <strong>${escapeHtml(input.projectName)}</strong> with you as <strong>${roleLabel}</strong>.</p>
<p><a href="${site}/account/projects?tab=shared">Open shared projects</a></p>`
  return sendMail({ to: input.to, subject, html, text })
}

export async function sendProjectInviteWithPasswordEmail(input: {
  to: string
  inviteeName: string
  projectName: string
  role: "viewer" | "editor"
  inviterName: string
  temporaryPassword: string
}): Promise<MailResult> {
  const site = siteBase()
  const roleLabel = input.role === "editor" ? "editor" : "viewer"
  const subject = `You're invited to “${input.projectName}”`
  const text = [
    `Hi ${input.inviteeName},`,
    ``,
    `${input.inviterName} invited you to InnoHub and shared “${input.projectName}” as ${roleLabel}.`,
    ``,
    `Sign in: ${site}/login`,
    `Email: ${input.to}`,
    `Temporary password: ${input.temporaryPassword}`,
    ``,
    `You will be asked to change this password after sign-in.`,
  ].join("\n")
  const html = `<p>Hi ${escapeHtml(input.inviteeName)},</p>
<p>${escapeHtml(input.inviterName)} invited you to InnoHub and shared <strong>${escapeHtml(input.projectName)}</strong> as <strong>${roleLabel}</strong>.</p>
<p>Sign in at <a href="${site}/login">${site}/login</a><br/>
Email: ${escapeHtml(input.to)}<br/>
Temporary password: <code>${escapeHtml(input.temporaryPassword)}</code></p>
<p>You will be asked to change this password after sign-in.</p>`
  return sendMail({ to: input.to, subject, html, text })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
