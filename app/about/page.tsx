import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"

const content = [
  {
    title: "What is Innovation HUB?",
    text: "Innovation HUB is a curated platform for high-quality video content exploring cutting-edge technology, design thinking, and the future of digital innovation. We bring together thought leaders, engineers, and creators from around the world to share ideas that matter.",
  },
  {
    title: "Who is this for?",
    text: "Whether you are a startup founder, a seasoned engineer, a product designer, or simply curious about the future, Innovation HUB offers insights tailored to anyone passionate about building what comes next.",
  },
  {
    title: "How do we select content?",
    text: "Our editorial team reviews hundreds of submissions each month. We prioritize originality, depth of insight, production quality, and relevance to emerging trends in technology and innovation.",
  },
]

export default function AboutPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="mb-12 font-display text-3xl font-bold text-foreground md:text-4xl">
            About Us
          </h1>
          <div className="flex flex-col gap-10">
            {content.map((item, i) => (
              <div key={i}>
                <h2 className="mb-3 font-display text-xl font-semibold text-foreground md:text-2xl">
                  {item.title}
                </h2>
                <p className="text-base leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>
      <FooterSection />
    </div>
  )
}
