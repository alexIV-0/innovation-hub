"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { User, LogIn } from "lucide-react"

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="font-display text-lg font-bold text-primary-foreground">IH</span>
            </div>
          </Link>
          
          <nav className="hidden items-center gap-1 md:flex">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/about">About</Link>
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/">Project</Link>
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/contact">Contact</Link>
            </Button>
          </nav>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            asChild
          >
            <Link href="/login">
              <LogIn className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Sign In</span>
            </Link>
          </Button>
          <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" asChild>
            <Link href="/register">
              <User className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">Register</span>
            </Link>
          </Button>
        </div>
      </div>
    </header>
  )
}
