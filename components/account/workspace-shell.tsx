"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import {
  ChevronLeft,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Wallet,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { UserRole } from "@/lib/domain-types"
import {
  I18nProvider,
  avatarInitials,
  formatBalance,
  useI18n,
} from "@/components/account/i18n"

export type WorkspaceUser = {
  email: string
  fullName: string
  role: UserRole
  balanceCents: number
}

type ShellProps = WorkspaceUser & {
  children: React.ReactNode
}

function NavItem({
  href,
  active,
  icon,
  label,
  collapsed,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
  collapsed: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[14px] font-medium transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-[rgba(45,131,206,0.16)] text-[#eef1f6]"
          : "text-[#c3c8d2] hover:bg-white/5 hover:text-[#eef1f6]",
      )}
    >
      {active && (
        <span className="absolute bottom-[9px] left-0 top-[9px] w-[3px] rounded-[3px] bg-[#2f80ed]" />
      )}
      <span className={cn(active ? "text-[#6aa5e8]" : "text-[#8b909c]")}>
        {icon}
      </span>
      {!collapsed && <span className="flex-1 whitespace-nowrap">{label}</span>}
    </Link>
  )
}

function SidebarContent({
  user,
  collapsed,
  onToggle,
  onNavigate,
}: {
  user: WorkspaceUser
  collapsed: boolean
  onToggle?: () => void
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { t, lang, setLang } = useI18n()
  const initials = avatarInitials(user.fullName, user.email)

  const isDash = pathname === "/account"
  const isProjects = pathname.startsWith("/account/projects")
  const isProfile = pathname.startsWith("/account/profile")

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "flex h-16 shrink-0 items-center gap-2.5 px-3.5",
          collapsed && "justify-center",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] border border-[rgba(91,155,224,0.4)] bg-gradient-to-br from-[#1f3a63] to-[#16273f] text-[12px] font-bold tracking-wide text-[#7fb0f0]"
        >
          FF
        </button>
        {!collapsed && (
          <>
            <span className="flex-1 whitespace-nowrap text-[16px] font-semibold text-[#eef1f6]">
              FF Works
            </span>
            {onToggle && (
              <button
                type="button"
                onClick={onToggle}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#9aa0ac] hover:bg-white/5 hover:text-[#eef1f6]"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 px-3 pb-1 pt-1.5">
        <div
          className={cn(
            "rounded-xl border border-[rgba(91,155,224,0.28)] bg-gradient-to-br from-[rgba(45,131,206,0.16)] to-[rgba(45,131,206,0.03)]",
            collapsed ? "p-2.5" : "p-3.5",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2",
              collapsed && "justify-center",
            )}
          >
            <Wallet className="h-[19px] w-[19px] text-[#8fb8ea]" />
            {!collapsed && (
              <span className="flex-1 text-[10.5px] font-semibold tracking-[1.4px] text-[#8fb8ea]">
                {t.balance}
              </span>
            )}
          </div>
          {!collapsed && (
            <>
              <div className="mt-2 text-[22px] font-bold tracking-tight text-[#eef1f6]">
                {formatBalance(user.balanceCents, lang)}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="truncate text-[11.5px] text-[#9aa0ac]">
                  {t.renderMinutes}
                </span>
                <button
                  type="button"
                  className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1 text-[12px] text-[#eef1f6] hover:bg-white/[0.18]"
                >
                  {t.topup}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <nav className="flex shrink-0 flex-col gap-1 px-3 py-2">
        {!collapsed && (
          <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold tracking-[1.4px] text-[#5a606e]">
            {t.workspaceSection}
          </div>
        )}
        <div onClick={onNavigate}>
          <NavItem
            href="/account"
            active={isDash}
            collapsed={collapsed}
            icon={<LayoutDashboard className="h-5 w-5" />}
            label={t.dashboard}
          />
        </div>
        <div onClick={onNavigate}>
          <NavItem
            href="/account/projects"
            active={isProjects}
            collapsed={collapsed}
            icon={<FolderOpen className="h-5 w-5" />}
            label={t.projects}
          />
        </div>
        {user.role === "ADMIN" && (
          <div onClick={onNavigate}>
            <NavItem
              href="/admin"
              active={false}
              collapsed={collapsed}
              icon={<Shield className="h-5 w-5" />}
              label={t.adminPanel}
            />
          </div>
        )}
      </nav>

      <div className="flex-1" />

      <div className={cn("shrink-0 px-3 pt-2.5", collapsed && "px-2")}>
        <div
          className={cn(
            "flex gap-1 rounded-[9px] border border-white/10 bg-[#0d121c] p-[3px]",
            collapsed ? "flex-col" : "flex-row",
          )}
        >
          {(["ru", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              title={l === "ru" ? "Русский" : "English"}
              onClick={() => setLang(l)}
              className={cn(
                "rounded-md text-[13px] font-semibold tracking-wide",
                collapsed ? "h-7 w-full" : "h-7 flex-1",
                lang === l
                  ? "bg-[rgba(45,131,206,0.35)] text-[#eef1f6]"
                  : "bg-transparent text-[#8b909c] hover:text-[#eef1f6]",
              )}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("shrink-0 p-3", collapsed && "px-2")}>
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-xl border p-2.5",
            isProfile
              ? "border-[rgba(91,155,224,0.45)] bg-[rgba(45,131,206,0.12)]"
              : "border-white/10 bg-transparent",
            collapsed && "justify-center p-1.5",
          )}
        >
          <Link
            href="/account/profile"
            onClick={onNavigate}
            className={cn(
              "flex min-w-0 items-center gap-2.5",
              collapsed ? "justify-center" : "flex-1",
            )}
          >
            <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#7fb0f0] to-[#4a7fd6] text-[13px] font-bold text-[#0d1626]">
              {initials}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13.5px] text-[#eef1f6]">
                  {user.fullName || user.email}
                </div>
                <div className="truncate text-[11.5px] text-[#7c8290]">
                  {user.email}
                </div>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              title={t.logout}
              onClick={signOut}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[#8b909c] hover:bg-white/10 hover:text-[#eef1f6]"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function WorkspaceShellInner({
  email,
  fullName,
  role,
  balanceCents,
  children,
}: ShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const user: WorkspaceUser = { email, fullName, role, balanceCents }
  const { t } = useI18n()
  const pathname = usePathname()

  const title =
    pathname === "/account"
      ? t.dashboard
      : pathname.startsWith("/account/projects")
        ? t.projects
        : pathname.startsWith("/account/profile")
          ? t.profileTitle
          : "FF Works"

  return (
    <div
      className="flex h-dvh w-full overflow-hidden bg-[hsl(226_31%_7%)] font-[family-name:var(--font-ibm-plex)] text-[#eef1f6]"
      style={{ fontFamily: "var(--font-ibm-plex), system-ui, sans-serif" }}
    >
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "relative hidden shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-[hsl(226_28%_9%)] lg:flex",
          collapsed ? "w-[72px]" : "w-[248px]",
        )}
      >
        <SidebarContent
          user={user}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[58px] shrink-0 items-center gap-2.5 border-b border-white/[0.07] bg-[hsl(226_28%_9%)] px-3 lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-[11px] border border-[rgba(91,155,224,0.4)] bg-gradient-to-br from-[#1f3a63] to-[#16273f] text-[12px] font-bold text-[#7fb0f0]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="flex-1 text-[16px] font-semibold">{title}</span>
          <Link
            href="/account/profile"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-gradient-to-br from-[#7fb0f0] to-[#4a7fd6] text-[12.5px] font-bold text-[#0d1626]"
          >
            {avatarInitials(fullName, email)}
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-black/60 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="flex h-full w-[274px] max-w-[82%] flex-col border-r border-white/10 bg-[hsl(226_28%_9%)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-end p-2">
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9aa0ac] hover:bg-white/5"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <SidebarContent
              user={user}
              collapsed={false}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function WorkspaceShell(props: ShellProps) {
  return (
    <I18nProvider>
      <WorkspaceShellInner {...props} />
    </I18nProvider>
  )
}
