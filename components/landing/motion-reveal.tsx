"use client"

import { motion, type MotionProps } from "framer-motion"
import type { PropsWithChildren } from "react"

type MotionRevealProps = PropsWithChildren<{
  className?: string
  delay?: number
  y?: number
  once?: boolean
}> &
  Omit<MotionProps, "children">

export function MotionReveal({
  children,
  className,
  delay = 0,
  y = 18,
  once = true,
  ...props
}: MotionRevealProps) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
