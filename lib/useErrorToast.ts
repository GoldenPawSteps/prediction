import { useEffect } from 'react'

export function useErrorToast(error: unknown, message = 'Something went wrong') {
  useEffect(() => {
    if (!error) return

    // Abort/cancel errors are expected during navigation, polling overlap, and timeouts.
    if (error instanceof Error && error.name === 'AbortError') return
    if (error instanceof Error && /aborted|abort/i.test(error.message)) return

    // Dynamically import react-hot-toast only when needed
    import('react-hot-toast').then(({ toast }) => {
      // Keep one toast per message visible instead of stacking duplicates.
      toast.error(message, { id: `error:${message}` })
    })
  }, [error, message])
}
