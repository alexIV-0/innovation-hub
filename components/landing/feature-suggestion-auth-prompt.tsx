import Link from "next/link"
import { LogIn, UserPlus } from "lucide-react"
import { Button } from "@/components/ui/button"

const LOGIN_NEXT = "/login?next=%2F%23feature-suggestion"

export function FeatureSuggestionAuthPrompt({
  variant,
}: {
  variant: "sign-in" | "inactive"
}) {
  if (variant === "inactive") {
    return (
      <div className="premium-card rounded-[28px] border border-border/70 bg-surface-2/50 p-6 text-center md:p-8">
        <p className="type-body text-muted-foreground">
          Your account is inactive. Contact an administrator if you need to submit suggestions.
        </p>
      </div>
    )
  }

  return (
    <div className="premium-card rounded-[28px] border border-border/70 bg-surface-2/50 p-6 text-center md:p-8">
      <p className="type-body mx-auto max-w-lg text-muted-foreground">
        Sign in to suggest automations. This keeps submissions tied to real accounts and helps us
        reduce spam.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" className="h-11 rounded-full px-6 shadow-glow" asChild>
          <Link href={LOGIN_NEXT}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign in
          </Link>
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="h-11 rounded-full border border-border/80 bg-surface-2/90 px-6"
          asChild
        >
          <Link href="/register">
            <UserPlus className="mr-2 h-4 w-4" />
            Create account
          </Link>
        </Button>
      </div>
    </div>
  )
}
