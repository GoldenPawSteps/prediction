"use client"

import { useLayoutEffect } from "react"
import { usePathname } from "next/navigation"
import { consumeNavScrollReset, endNavFeedback } from "@/lib/client-nav-feedback"

export function NavProgressCleanup() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    const shouldResetScroll = consumeNavScrollReset()
    endNavFeedback()

    // Only force a top reset for in-app forward navigations that explicitly
    // started nav feedback. Back/forward navigations should keep the browser's
    // own restoration behavior to avoid stale blank offsets.
    if (shouldResetScroll) {
      window.scrollTo(0, 0)
    }
  }, [pathname])

  return null
}
