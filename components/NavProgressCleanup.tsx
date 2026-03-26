"use client"

import { useEffect } from "react"
import { endNavFeedback } from "@/lib/client-nav-feedback"

export function NavProgressCleanup() {
  useEffect(() => {
    endNavFeedback()
  }, [])
  return null
}
