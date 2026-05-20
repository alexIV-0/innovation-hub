import { MotionReveal } from "@/components/landing/motion-reveal"
import { FeatureSuggestionAuthPrompt } from "@/components/landing/feature-suggestion-auth-prompt"
import { FeatureSuggestionForm } from "@/components/landing/feature-suggestion-form"
import { SectionHeading } from "@/components/landing/section-heading"
import { getCurrentUser } from "@/lib/admin-auth"

export async function FeatureSuggestionSection() {
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null
  try {
    user = await getCurrentUser()
  } catch (error) {
    console.error(
      "[feature-suggestion-section] getCurrentUser:",
      error instanceof Error ? error.message : error,
    )
  }

  return (
    <section
      id="feature-suggestion"
      className="scroll-mt-24 section-space border-b border-border/40 bg-surface-1/70"
    >
      <div className="section-shell">
        <MotionReveal className="space-y-8">
          <SectionHeading
            eyebrow="Your idea"
            title="Suggest a feature"
            description="Tell us what automation would help your team. We review every submission and track it in our product backlog."
          />
          {user?.isActive ? (
            <FeatureSuggestionForm />
          ) : (
            <FeatureSuggestionAuthPrompt
              variant={user && !user.isActive ? "inactive" : "sign-in"}
            />
          )}
        </MotionReveal>
      </div>
    </section>
  )
}
