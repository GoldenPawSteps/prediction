"use client"

import { useLayoutEffect } from "react"
import { usePathname } from "next/navigation"
import { endNavFeedback } from "@/lib/client-nav-feedback"

export function NavProgressCleanup() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    endNavFeedback()
    // Fires synchronously after new route DOM is committed but before the
    // browser paints — skeletons always appear at top, no current-page jump.
    window.scrollTo(0, 0)
  }, [pathname])

  return null
}
