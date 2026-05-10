import { useState } from 'react'
import { Heart } from 'lucide-react'
import { motion } from 'framer-motion'
import { formatLocalDate } from '../lib/dateUtils'
import { useHaptics } from '../hooks/useHaptics'

// TODO: replace before Mother's Day
export const MOTHERS_DAY_MESSAGE =
  "I wanted to leave this here to remind you how much I love you — how much you mean to this family, and how much we appreciate everything you do. You're the best, and I wouldn't want to build this life with anyone else. Love Matt (Papa), Tiger, & Sadie (Peanut)"

const STORAGE_KEY = 'rr_mothers_day_2026_dismissed_v1'
const TARGET_DATE = '2026-05-10'

// Graceful fallback: if motion.div is unavailable, render without animation
// (animation props are intentionally excluded from the plain-div path to avoid DOM warnings)
const AnimDiv = motion?.div ?? 'div'
const animProps = motion?.div
  ? { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4, ease: 'easeOut' } }
  : {}

export default function MothersDayCard() {
  const { trigger } = useHaptics()
  const [visible, setVisible] = useState(
    () =>
      formatLocalDate(new Date()) === TARGET_DATE &&
      localStorage.getItem(STORAGE_KEY) !== 'true'
  )

  if (!visible) return null

  function dismiss() {
    trigger('light')
    localStorage.setItem(STORAGE_KEY, 'true')
    setVisible(false)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mother's Day greeting"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={dismiss}
    >
      <AnimDiv
        {...animProps}
        className="card max-w-sm w-full mx-5 text-center"
        onClick={e => e.stopPropagation()}
      >
        <Heart size={28} className="text-brand-500 mx-auto mb-4" fill="currentColor" />
        <h2 className="section-heading mb-3">Happy Mother's Day</h2>
        <p className="body-text mb-6">{MOTHERS_DAY_MESSAGE}</p>
        <button className="btn-primary" onClick={dismiss}>
          Continue
        </button>
      </AnimDiv>
    </div>
  )
}
