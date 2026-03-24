/**
 * Section Error Boundary
 * Gracefully handles errors in individual page sections
 * Prevents one failed section from breaking the entire page
 */

'use client'

import React, { ReactNode } from 'react'

interface SectionErrorBoundaryProps {
  children: ReactNode
  sectionName: string
  fallback?: ReactNode
}

interface SectionErrorBoundaryState {
  hasError: boolean
  error?: Error
}

export class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  constructor(props: SectionErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): SectionErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(
      `[SectionErrorBoundary] Error in section "${this.props.sectionName}":`,
      error,
      errorInfo
    )
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-600 dark:text-red-400">
              Failed to load {this.props.sectionName}
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <p className="text-xs text-red-500 mt-2 font-mono">
                {this.state.error.message}
              </p>
            )}
          </div>
        )
      )
    }

    return this.props.children
  }
}
