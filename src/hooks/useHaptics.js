import { useCallback } from 'react'

// Named-level map: string → vibration duration(s) in ms.
const PATTERNS = {
  selection: 8,   // chip toggle, star tap — brief selection pulse
  light: 12,      // tap-to-open, add, regenerate
  medium: 25,     // save, commit, delete — user-committed writes
  success: 20,    // alias kept for backward compatibility with existing callers
  error: [20, 50, 20], // double buzz for destructive errors
}

export function useHaptics() {
  const trigger = useCallback((level = 'light') => {
    if (typeof window === 'undefined' || !navigator.vibrate) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    try {
      navigator.vibrate(typeof level === 'number' ? level : (PATTERNS[level] ?? 12))
    } catch {
      // ignore — navigator.vibrate is best-effort
    }
  }, [])

  return { trigger }
}
