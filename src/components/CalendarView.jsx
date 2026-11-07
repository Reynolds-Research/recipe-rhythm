import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchScheduledItemsInRange } from '../lib/mealPlanReader'
import { loadCalendarRange } from '../lib/plannedMeals'
import { isNewPrepTableEnabled } from '../lib/featureFlags'
import Logo from './Logo'

// --- Date helpers (UTC-based, AUDIT U8 discipline) -------------------------

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function formatIso(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

// Build a 42-cell (6 row) grid starting from the Sunday on or before the 1st.
function buildMonthGrid(year, monthIdx) {
  const firstOfMonth = new Date(Date.UTC(year, monthIdx, 1))
  const startDow = firstOfMonth.getUTCDay()
  const cells = []
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

// Pre-fetch one month on each side so prev/next feels instant.
function fetchRangeForMonth(year, monthIdx) {
  const from = new Date(Date.UTC(year, monthIdx - 1, 1))
  const to = new Date(Date.UTC(year, monthIdx + 2, 0)) // last day of monthIdx+1
  return { from: formatIso(from), to: formatIso(to) }
}

function monthKey(year, monthIdx) {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

// --- Per-date cell classification ------------------------------------------
//
// Every cell reports one of four "period states" for shading. The order of
// precedence (most specific wins): finalized > active > none. Gap-day fills
// when no period covers the date but there IS a period in the visible window
// — purely visual, to echo the "between periods" feeling from GapDayView.

function buildDateIndex(rows) {
  const byDate = new Map()
  for (const r of rows) {
    const arr = byDate.get(r.scheduled_date) ?? []
    arr.push(r)
    byDate.set(r.scheduled_date, arr)
  }
  return byDate
}

// Returns the inclusive [start, end] ranges for each distinct plan in rows.
// Multiple items can share a plan — we dedupe by meal_plan_id.
function buildPeriodRanges(rows) {
  const seen = new Map()
  for (const r of rows) {
    if (!r.meal_plan_id || !r.period_start || !r.period_end) continue
    if (!seen.has(r.meal_plan_id)) {
      seen.set(r.meal_plan_id, {
        periodStart: r.period_start,
        periodEnd: r.period_end,
        finalized: !!r.finalized_at,
      })
    }
  }
  return Array.from(seen.values())
}

function periodStateForDate(iso, periods) {
  for (const p of periods) {
    if (iso >= p.periodStart && iso <= p.periodEnd) {
      if (p.confirmed) return 'confirmed'
      return p.finalized ? 'finalized' : 'active'
    }
  }
  return null
}

// PRD-008 2c: with the new Prep Table on, the calendar reads planned_meals
// and shades the weeks she confirmed. Off, it reads the old plan tables
// exactly as before. Both return { rows, periods } in the same shapes.
async function fetchMonth(userId, from, to, planned) {
  if (!planned) {
    const rows = await fetchScheduledItemsInRange(supabase, userId, from, to)
    return { rows, periods: buildPeriodRanges(rows) }
  }
  const { meals, confirmations } = await loadCalendarRange(supabase, userId, from, to)
  return {
    rows: meals.map((m) => ({
      item_id: m.id,
      scheduled_date: m.planned_on,
      name: m.name,
      cooked: !!m.cooked,
    })),
    periods: confirmations.map((c) => ({
      periodStart: c.starts_on,
      periodEnd: c.ends_on,
      confirmed: true,
    })),
  }
}

const EMPTY = { rows: [], periods: [] }

// --- Component -------------------------------------------------------------

/**
 * CalendarView — read-only month-grid showing period shading and scheduled
 * meals. ADR-001 Phase 6. No mutations; tapping a date with items opens a
 * dismissible popover with meal names + period info.
 *
 * @param {{ userId: string, initialMonth?: Date, newPrepTable?: boolean }} props
 *   newPrepTable defaults to the VITE_NEW_PREP_TABLE switch.
 */
export default function CalendarView({ userId, initialMonth, newPrepTable }) {
  const planned = newPrepTable ?? isNewPrepTableEnabled()
  const seed = initialMonth ?? new Date()
  const [year, setYear] = useState(seed.getFullYear())
  const [monthIdx, setMonthIdx] = useState(seed.getMonth())

  // Cache fetched rows keyed by `${year}-${mm}` (the month that was *centered*
  // when fetched — since each fetch spans prev/curr/next, we index by center).
  // Avoids re-fetch thrash when the user flips back and forth.
  const cacheRef = useRef(new Map())
  const [data, setData] = useState(EMPTY) // { rows, periods } for the *visible* month
  const [loading, setLoading] = useState(true)

  // Popover state: null or { iso, items }
  const [popover, setPopover] = useState(null)

  const cells = useMemo(() => buildMonthGrid(year, monthIdx), [year, monthIdx])
  const todayYmd = formatLocalYmd(new Date())

  useEffect(() => {
    let cancelled = false
    const key = monthKey(year, monthIdx)
    const cached = cacheRef.current.get(key)
    if (cached) {
      setData(cached)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    const { from, to } = fetchRangeForMonth(year, monthIdx)
    fetchMonth(userId, from, to, planned)
      .then((result) => {
        if (cancelled) return
        cacheRef.current.set(key, result)
        setData(result)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // Soft-fail the calendar — show empty grid rather than an error screen.
        cacheRef.current.set(key, EMPTY)
        setData(EMPTY)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId, year, monthIdx, planned])

  const dateIndex = useMemo(() => buildDateIndex(data.rows), [data])
  const periods = data.periods

  const prevMonth = () => {
    setPopover(null)
    if (monthIdx === 0) {
      setMonthIdx(11)
      setYear(year - 1)
    } else {
      setMonthIdx(monthIdx - 1)
    }
  }
  const nextMonth = () => {
    setPopover(null)
    if (monthIdx === 11) {
      setMonthIdx(0)
      setYear(year + 1)
    } else {
      setMonthIdx(monthIdx + 1)
    }
  }

  const handleCellClick = (iso) => {
    const items = dateIndex.get(iso)
    if (!items || items.length === 0) return
    const confirmed = planned
      ? periods.find((p) => iso >= p.periodStart && iso <= p.periodEnd) ?? null
      : undefined
    setPopover({ iso, items, confirmed })
  }

  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">
          Calendar
        </h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">
          Your planning history
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={prevMonth}
            className="btn-icon"
            aria-label="Previous month"
            data-testid="calendar-prev"
          >
            <ChevronLeft size={20} />
          </button>
          <span
            className="text-base font-semibold text-gray-900"
            data-testid="calendar-month-label"
          >
            {monthLabel(year, monthIdx)}
          </span>
          <button
            onClick={nextMonth}
            className="btn-icon"
            aria-label="Next month"
            data-testid="calendar-next"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAY_LETTERS.map((l, i) => (
            <div
              key={i}
              className="text-sm font-bold text-gray-700 text-center uppercase tracking-wider"
            >
              {l}
            </div>
          ))}
        </div>

        <div
          className={`grid grid-cols-7 gap-1 mb-5 transition-opacity ${
            loading ? 'opacity-60' : 'opacity-100'
          }`}
          data-testid="calendar-grid"
        >
          {cells.map((cell) => {
            const items = dateIndex.get(cell.iso) ?? []
            const hasItems = items.length > 0
            const periodState = periodStateForDate(cell.iso, periods)
            const isToday = cell.iso === todayYmd

            // Color coding:
            //   finalized → warm cream (period is locked)
            //   confirmed → warm cream (new Prep Table: a week she confirmed)
            //   active    → brand-100 tint (period is live / in-progress)
            //   no period → neutral white
            //   today     → ring-brand-500
            const base =
              'relative aspect-square rounded-lg border flex items-center justify-center transition-colors'
            let tint = 'bg-white border-cream-100'
            if (periodState === 'finalized' || periodState === 'confirmed') {
              tint = 'bg-cream-200/60 border-cream-200'
            } else if (periodState === 'active') {
              tint = 'bg-brand-100/70 border-brand-200'
            }
            const ring = isToday ? 'ring-2 ring-brand-500' : ''
            const muted = !cell.inMonth ? 'opacity-40' : ''
            const clickable = hasItems ? 'cursor-pointer hover:brightness-95' : 'cursor-default'

            return (
              <button
                key={cell.iso}
                type="button"
                onClick={() => handleCellClick(cell.iso)}
                className={`${base} ${tint} ${ring} ${muted} ${clickable}`}
                data-testid={`calendar-cell-${cell.iso}`}
                data-period-state={periodState ?? 'none'}
                data-has-items={hasItems ? 'true' : 'false'}
                data-in-month={cell.inMonth ? 'true' : 'false'}
                aria-label={`${cell.iso}${hasItems ? ` — ${items.length} scheduled` : ''}`}
              >
                <span className="flex flex-col items-center gap-0.5">
                  <span
                    className={`text-sm font-semibold flex items-center justify-center ${
                      isToday ? 'w-7 h-7 bg-brand-500 text-white rounded-full' : 'text-gray-900'
                    }`}
                  >
                    {cell.dayNum}
                  </span>
                  {hasItems && (
                    <span
                      className="block w-1.5 h-1.5 rounded-full bg-brand-500"
                      data-testid={`calendar-dot-${cell.iso}`}
                      aria-hidden="true"
                    />
                  )}
                </span>
              </button>
            )
          })}
        </div>

        <Legend planned={planned} />
      </div>

      {popover && (
        <DayPopover
          iso={popover.iso}
          items={popover.items}
          confirmed={popover.confirmed}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  )
}

function Legend({ planned = false }) {
  return (
    <div
      className="bg-white border border-cream-100 rounded-2xl px-4 py-3 shadow-sm"
      data-testid="calendar-legend"
    >
      <p className="section-heading mb-2">Legend</p>
      <p className="helper-text mb-3">Tap any day for details.</p>
      {planned ? (
        <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-700">
          <LegendSwatch cls="bg-cream-200/60 border-cream-200" label="Confirmed week" />
          <LegendSwatch cls="bg-white border-brand-500 ring-2 ring-brand-500" label="Today" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-y-2 text-sm text-gray-700">
          <LegendSwatch cls="bg-brand-100/70 border-brand-200" label="Active period" />
          <LegendSwatch cls="bg-cream-200/60 border-cream-200" label="Finalized" />
          <LegendSwatch cls="bg-white border-cream-100" label="Gap day" />
          <LegendSwatch cls="bg-white border-brand-500 ring-2 ring-brand-500" label="Today" />
        </div>
      )}
    </div>
  )
}

function LegendSwatch({ cls, label }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-4 h-4 rounded border ${cls}`} />
      <span>{label}</span>
    </div>
  )
}

// `confirmed`: undefined = old screens (period from the first item, as
// before); null or { periodStart, periodEnd } = new Prep Table.
function DayPopover({ iso, items, confirmed, onClose }) {
  const first = items[0]
  const periodStart = first?.period_start
  const periodEnd = first?.period_end
  const finalized = !!first?.finalized_at

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[55] flex items-end sm:items-center justify-center"
      onClick={onClose}
      data-testid="calendar-popover-backdrop"
    >
      <div
        className="w-full max-w-sm bg-cream-50 rounded-t-3xl sm:rounded-3xl px-6 pt-5 pb-6 shadow-2xl border-t border-cream-200"
        onClick={(e) => e.stopPropagation()}
        data-testid="calendar-popover"
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="section-heading text-brand-600">
              {formatShortDate(iso)}
            </p>
            {confirmed && (
              <p className="text-sm text-gray-700 mt-1" data-testid="calendar-popover-confirmed">
                Confirmed {formatShortDate(confirmed.periodStart)} – {formatShortDate(confirmed.periodEnd)}
              </p>
            )}
            {confirmed === undefined && periodStart && periodEnd && (
              <p className="text-sm text-gray-700 mt-1">
                Period: {formatShortDate(periodStart)} – {formatShortDate(periodEnd)}
                {finalized && (
                  <span className="ml-2 text-brand-600 font-semibold">
                    · Finalized
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Close"
            data-testid="calendar-popover-close"
          >
            <X size={18} />
          </button>
        </div>

        <div
          className="bg-white border border-cream-100 rounded-2xl px-4 py-2 divide-y divide-cream-50"
          data-testid="calendar-popover-items"
        >
          {items.map((item) => (
            <div key={item.item_id} className="flex items-center gap-3 py-3">
              <span
                className={`text-base flex-1 font-medium leading-snug ${
                  item.cooked ? 'line-through text-gray-500' : 'text-gray-900'
                }`}
              >
                {item.name}
              </span>
              {item.cooked && (
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  Cooked
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
