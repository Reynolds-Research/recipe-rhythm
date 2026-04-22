import { useCallback } from 'react'

export function useHaptics() {
  const triggerHaptic = useCallback((pattern = 10) => {
    if (typeof window !== 'undefined' && navigator.vibrate) {
      try {
        navigator.vibrate(pattern)
      // eslint-disable-next-line no-unused-vars
      } catch (_e) {
        // ignore
      }
    }
  }, [])

  return { trigger: triggerHaptic }
}
