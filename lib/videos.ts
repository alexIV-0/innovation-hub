export interface Video {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  category: string
}

export const videos: Video[] = [
  {
    id: "1",
    title: "The Future of Artificial Intelligence",
    description:
      "Explore how AI is reshaping industries, from healthcare to creative arts. This deep dive covers the latest breakthroughs in machine learning, natural language processing, and autonomous systems that are defining the next era of human-computer interaction.",
    thumbnail: "https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    duration: "12:34",
    category: "AI",
  },
  {
    id: "2",
    title: "Designing for the Next Billion Users",
    description:
      "A look at how product design is evolving to meet the needs of emerging markets. Learn about accessibility-first approaches, offline capabilities, and culturally aware interfaces that connect people across the globe.",
    thumbnail: "https://images.unsplash.com/photo-1559028012-481c04fa702d?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
    duration: "8:15",
    category: "Design",
  },
  {
    id: "3",
    title: "Sustainable Tech: Building a Greener Future",
    description:
      "How the tech industry is tackling climate change through sustainable innovation. From renewable energy-powered data centers to carbon-neutral supply chains, discover the green revolution happening in Silicon Valley and beyond.",
    thumbnail: "https://images.unsplash.com/photo-1497435334941-8c899ee9e8e9?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
    duration: "15:42",
    category: "Sustainability",
  },
  {
    id: "4",
    title: "The Rise of Decentralized Systems",
    description:
      "Understanding how decentralized architectures are transforming finance, governance, and data ownership. This session breaks down the real-world applications and challenges of building trustless systems at scale.",
    thumbnail: "https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
    duration: "10:08",
    category: "Web3",
  },
  {
    id: "5",
    title: "Robotics in Everyday Life",
    description:
      "From warehouse automation to home assistants, robotics is becoming part of our daily routines. See how startups and research labs are pushing the boundaries of what machines can do alongside humans.",
    thumbnail: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
    duration: "9:20",
    category: "Robotics",
  },
  {
    id: "6",
    title: "Quantum Computing Explained",
    description:
      "A beginner-friendly breakdown of quantum computing, its potential, and its limitations. Learn about qubits, superposition, and entanglement, and discover why leading companies are investing billions in this emerging technology.",
    thumbnail: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=600&h=600&fit=crop",
    videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
    duration: "18:50",
    category: "Science",
  },
]
