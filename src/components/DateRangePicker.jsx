import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { checkPeriodOverlap } from '../lib/mealPlanWriter'

// --- Pure date math --------------------------------------------------------
// All dates are exchanged as 'YYYY-MM-DD' strings on the outside. Internally
// we use UTC `Date` objects to keep month arithmetic timezone-independent.

const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function formatIso(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function monthLabel(year, monthIdx) {
  const dt = new Date(Date.UTC(year, monthIdx, 1))
  return dt.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatShortDate(iso) {
  return parseIso(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Build the day cells for a month grid, including leading blanks from the
// prior month so the grid is aligned on Sunday. Returns 42 cells (6 weeks) so
// the grid height is stable across months — any cell outside the target month
// gets `inMonth = false` and is rendered as a visual spacer.
function buildMonthGrid(year, monthIdx) {
  const firstOfMonth = new Date(Date.UTC(year, monthIdx, 1))
  const startDow = firstOfMonth.getUTCDay()
  const cells = []
  // Start from the Sunday on or before the 1st.
  const gridStart = new Date(Date.UTC(year, monthIdx, 1 - startDow))
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setUTCDate(gridStart.getUTCDate() + i)
    cells.push({
      iso: formatIso(d),
      dayNum: d.getUTCDate(),
      inMonth: d.getUTCMonth() === monthIdx,
    })
  }
  return cells
}

/**
 * DateRangePicker
 *
 * A compact two-tap calendar picker. Exposed states:
 *   - tap 1 sets `start`
 *   - tap 2 sets `end` (auto-swaps if earlier than start)
 *   - tap 3 resets to `start` only
 *
 * Overlap validation runs (debounced) whenever a complete range is selected,
 * calling checkPeriodOverlap against the user's existing plans. Overlap is
 * the DB's EXCLUDE constraint turned into fast UI feedback — the constraint
 * remains the source of truth on write.
 *
 * No external calendar dependency on purpose: the app's convention is vanilla
 * Date math (see mealPlanWriter.derivePlanDates), and a hand-rolled month
 * grid keeps the bundle small.
 *
 * @param {{
 *   userId: string,
 *   initialStart?: string,
 *   onCancel: () => void,
 *   onConfirm: (range: { periodStart: string, periodEnd: string }) => void,
 * }} props
 */
export default function DateRangePicker({
  userId,
  initialStart,
  onCancel,
  onConfirm,
}) {
  // The month the grid is centered on. Defaults to either the initialStart's
  // month or today's month.
  const initial = useMemo(() => {
    const seed = initialStart ? parseIso(initialStart) : new Date()
    return {
      year: initialStart ? seed.getUTCFullYear() : seed.getFullYear(),
      monthIdx: initialStart ? seed.getUTCMonth() : seed.getMonth(),
    }
  }, [initialStart])

  const [year, setYear] = useState(initial.year)
  const [monthIdx, setMonthIdx] = useState(initial.monthIdx)
  // initialStart only hints which month to show first; the range always
  // starts empty so the user's first tap is always interpreted as "start".
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [overlap, setOverlap] = useState(null) // null | { period_start, period_end }
  const [checking, setChecking] = useState(false)

  const cells = useMemo(() => buildMonthGrid(year, monthIdx), [year, monthIdx])

  // Debounced overlap check against the server when a full range is selected.
  // Previous timer is cleared on every change so rapid re-taps don't pile up.
  const timerRef = useRef(null)
  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!start || !end) {
      setOverlap(null)
      setChecking(false)
      return
    }
    setChecking(true)
    timerRef.current = setTimeout(async () => {
      try {
        const result = await checkPeriodOverlap(supabase, userId, start, end)
        setOverlap(result.overlaps ? result.conflictingPeriod : null)
      } catch {
        // Soft-fail: if the check itself errored, let the user continue —
        // the DB's EXCLUDE constraint will reject the write as a fallback.
        setOverlap(null)
      } finally {
        setChecking(false)
      }
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [start, end, userId])

  const handleTap = (iso) => {
    if (!start || (start && end)) {
      // First tap OR resetting after a complete range.
      setStart(iso)
      setEnd(null)
      return
    }
    // Second tap: choose end. If earlier than start, swap.
    if (iso < start) {
      setEnd(start)
      setStart(iso)
    } else {
      setEnd(iso)
    }
  }

  const prevMonth = () => {
    if (monthIdx === 0) {
      setMonthIdx(11)
      setYear(year - 1)
    } else {
      setMonthIdx(monthIdx - 1)
    }
  }
  const nextMonth = () => {
    if (monthIdx === 11) {
      setMonthIdx(0)
      setYear(year + 1)
    } else {
      setMonthIdx(monthIdx + 1)
    }
  }

  const rangeEnd = end ?? start
  const isInRange = (iso) => start && rangeEnd && iso >= start && iso <= rangeEnd
  const isEdge = (iso) => iso === start || iso === end

  const canConfirm = !!(start && end && !overlap && !checking)

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[55] flex items-end sm:items-center justify-center"
      onClick={onCancel}
      data-testid="date-range-picker"
    >
      <div
        className="w-full max-w-sm bg-cream-50 rounded-t-3xl sm:rounded-3xl px-6 pt-6 pb-8 shadow-2xl border-t border-cream-200"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="section-heading mb-1">
          New Planning Period
        </p>
        <p className="text-base font-serif italic text-gray-700 mb-4">
          Pick your start and end dates
        </p>

        <div className="flex items-center justify-between mb-3">
          <button
            onClick={prevMonth}
            className="p-2 text-gray-500 hover:text-brand-600 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold text-gray-800">
            {monthLabel(year, monthIdx)}
          </span>
          <button
            onClick={nextMonth}
            className="p-2 text-gray-500 hover:text-brand-600 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS_SHORT.map((l, i) => (
            <div
              key={i}
              className="text-xs font-bold text-gray-700 text-center uppercase tracking-wider"
            >
              {l}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1 mb-4">
          {cells.map((cell) => {
            const inRange = isInRange(cell.iso)
            const edge = isEdge(cell.iso)
            const base = 'aspect-square flex items-center justify-center text-xs rounded-lg transition-colors'
            let cls
            if (edge) {
              cls = `${base} bg-brand-500 text-white font-bold`
            } else if (inRange) {
              cls = `${base} bg-brand-100 ${cell.inMonth ? 'text-brand-700' : 'text-brand-400'} font-semibold`
            } else if (!cell.inMonth) {
              cls = `${base} text-gray-500`
            } else {
              cls = `${base} text-gray-700 hover:bg-brand-50`
            }
            return (
              <button
                key={cell.iso}
                onClick={() => handleTap(cell.iso)}
                className={cls}
                data-testid={`calendar-day-${cell.iso}`}
                data-in-month={cell.inMonth ? 'true' : 'false'}
                data-selected={edge ? 'true' : 'false'}
              >
                {cell.dayNum}
              </button>
            )
          })}
        </div>

        <div className="mb-4 min-h-[32px]" data-testid="range-summary">
          {start && end ? (
            <p className="text-xs text-center text-gray-700">
              <span className="font-semibold">{formatShortDate(start)}</span>
              <span className="text-gray-700"> → </span>
              <span className="font-semibold">{formatShortDate(end)}</span>
            </p>
          ) : start ? (
            <p className="text-xs text-center text-gray-500">
              Start: <span className="font-semibold">{formatShortDate(start)}</span>. Tap an end date.
            </p>
          ) : (
            <p className="text-xs text-center text-gray-700">
              Tap a start date to begin.
            </p>
          )}
        </div>

        {overlap && (
          <div
            className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-3"
            data-testid="overlap-banner"
          >
            <p className="text-xs text-red-700 text-center">
              This range overlaps with your{' '}
              <span className="font-semibold">
                {formatShortDate(overlap.period_start)} – {formatShortDate(overlap.period_end)}
              </span>{' '}
              period.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500 font-medium"
            data-testid="picker-cancel"
          >
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm({ periodStart: start, periodEnd: end })}
            disabled={!canConfirm}
            className="flex-1 btn-primary flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            data-testid="picker-confirm"
          >
            {checking ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Checking…
              </>
            ) : (
              'Confirm'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
