import { useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setItemCooked, finalizePlan } from '../lib/mealPlanWriter'
import Logo from '../components/Logo'

/**
 * PeriodReview — ADR-001 Phase 4 end-of-period review surface.
 *
 * Same UI used both mid-period (cooked-toggle only) and post-period
 * (cooked-toggle + Lock-in CTA). The caller controls which mode by
 * passing `showFinalizeButton`; the toggle behavior is identical in
 * both cases per ADR Q2.
 */

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_ABBR = [
  'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec',
]

// Parse 'YYYY-MM-DD' as a local-calendar date so the displayed weekday and
// month/day match the date the user actually planned (no UTC drift —
// matches the reader/writer conventions; see AUDIT U8).
function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatPeriodRange(startYmd, endYmd) {
  if (!startYmd || !endYmd) return ''
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  const startMonth = MONTH_ABBR[start.getMonth()]
  const endMonth = MONTH_ABBR[end.getMonth()]
  const sameMonth =
    start.getMonth() === end.getMonth() &&
    start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`
}

function weekdayLabel(item) {
  if (item.scheduled_date) {
    return WEEKDAY_ABBR[parseYmd(item.scheduled_date).getDay()]
  }
  return item.day || ''
}

export default function PeriodReview({
  plan,
  onFinalized,
  onClose,
  showFinalizeButton,
}) {
  // Local copy so we can roll back optimistic toggles on failure without
  // round-tripping through the parent.
  const [items, setItems] = useState(() =>
    (plan?.items ?? []).map((it) => ({ ...it })),
  )
  const [error, setError] = useState(null)
  const [finalizing, setFinalizing] = useState(false)

  const handleToggle = async (idx) => {
    const target = items[idx]
    if (!target?.item_id) return

    const next = !target.cooked
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, cooked: next } : it)),
    )
    setError(null)

    try {
      await setItemCooked(supabase, target.item_id, next)
    } catch {
      setItems((prev) =>
        prev.map((it, i) => (i === idx ? { ...it, cooked: !next } : it)),
      )
      setError('Could not save change. Try again.')
    }
  }

  const handleFinalize = async () => {
    if (finalizing) return
    setFinalizing(true)
    setError(null)
    try {
      await finalizePlan(supabase, plan.id)
      onFinalized?.()
    } catch {
      setError('Could not finalize plan. Try again.')
    } finally {
      setFinalizing(false)
    }
  }

  const rangeLabel = formatPeriodRange(plan?.period_start, plan?.period_end)

  return (
    <div className="mobile-screen pb-28">

      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">
          Review Period
        </h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">
          {rangeLabel || 'Your meal plan'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

        <div>
          <p className="section-heading mb-3">Mark what you cooked</p>
          <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
            {items.length === 0 ? (
              <p className="py-6 helper-text text-center">
                This period has no scheduled meals.
              </p>
            ) : (
              items.map((item, idx) => {
                const dow = weekdayLabel(item)
                const inputId = `cooked-${item.item_id ?? `idx-${idx}`}`
                const disabled = !item.item_id
                return (
                  <div
                    key={item.item_id ?? `${idx}-${item.day}`}
                    className="flex items-center gap-3 py-3"
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={!!item.cooked}
                      disabled={disabled}
                      onChange={() => handleToggle(idx)}
                      style={{ accentColor: '#D74520' }}
                      className="h-5 w-5 rounded border-cream-200 focus:ring-brand-300 focus:ring-2 disabled:opacity-30"
                    />
                    <label
                      htmlFor={inputId}
                      className={`flex-1 cursor-pointer ${disabled ? 'cursor-not-allowed' : ''}`}
                    >
                      <div
                        className={`text-base font-medium leading-snug ${
                          item.cooked
                            ? 'line-through text-gray-500'
                            : 'text-gray-900'
                        }`}
                      >
                        {item.name}
                      </div>
                      <div className="text-sm font-bold text-brand-700 tracking-tighter uppercase mt-1">
                        {dow}
                      </div>
                    </label>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="text-xs text-red-600 text-center"
          >
            {error}
          </p>
        )}

        <div className="space-y-3">
          {showFinalizeButton && (
            <button
              onClick={handleFinalize}
              disabled={finalizing}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {finalizing ? (
                <><Loader2 size={16} className="animate-spin" /> Finalizing…</>
              ) : (
                <><Check size={16} /> Lock in and finalize</>
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="btn-secondary inline-flex items-center justify-center gap-2"
          >
            <X size={16} />
            Close
          </button>
        </div>

      </div>
    </div>
  )
}
