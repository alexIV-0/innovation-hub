import type { Metadata } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'

import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: 'Innovation HUB',
  description: 'Explore curated video content on innovation, technology, and design.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} min-h-screen font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  )
}
