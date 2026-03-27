import { useEffect } from 'react'

export function useErrorToast(error: unknown, message = 'Something went wrong') {
  useEffect(() => {
    if (!error) return
    // Dynamically import react-hot-toast only when needed
    import('react-hot-toast').then(({ toast }) => {
      toast.error(message)
    })
  }, [error, message])
}
