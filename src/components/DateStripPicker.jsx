import { useMemo, useState } from 'react'
import { Slash } from 'lucide-react'

// Local-calendar date helpers. We never go through toISOString() because the
// strip is a local-calendar concept ("today" depends on the user's wall clock).

function formatLocalYmd(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n)
}

function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatRangeLabel(startYmd, endYmd) {
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  const opts = { month: 'short', day: 'numeric' }
  const left = start.toLocaleDateString(undefined, opts)
  const right = end.toLocaleDateString(undefined, opts)
  return startYmd === endYmd ? left : `${left} – ${right}`
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function buildCells(today, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const date = addDays(today, i)
    out.push({
      ymd: formatLocalYmd(date),
      dayNum: date.getDate(),
      weekday: WEEKDAY_ABBR[date.getDay()],
    })
  }
  return out
}

/**
 * DateStripPicker — a 7- or 14-day strip of selectable date cells.
 *
 * Mobile-first replacement for the old weekday-chip picker. Renders today
 * through today+6 by default; tapping "Show another 7 days" reveals
 * today+7..today+13. Selection persists across collapse/expand.
 *
 * @param {{
 *   selectedDates: string[],            // controlled, 'YYYY-MM-DD' values
 *   disabledDates: Set<string>,         // dates inside an existing period
 *   onToggle: (date: string) => void,
 *   today?: Date,                       // injectable for tests; defaults to new Date()
 * }} props
 */
export default function DateStripPicker({
  selectedDates,
  disabledDates,
  onToggle,
  today,
}) {
  const todayDate = useMemo(() => {
    const seed = today ?? new Date()
    return new Date(seed.getFullYear(), seed.getMonth(), seed.getDate())
  }, [today])
  const todayYmd = useMemo(() => formatLocalYmd(todayDate), [todayDate])

  const allCells = useMemo(() => buildCells(todayDate, 14), [todayDate])
  const secondWeekStartYmd = allCells[7].ymd

  // Auto-expand on mount when any selected date falls in the second week so
  // the user can see what they have selected. After mount, expand/collapse is
  // fully manual — deselecting all second-week cells does NOT collapse, and
  // collapsing while a second-week date is selected is allowed (the count
  // line's range label keeps the offscreen selection obvious).
  const [expanded, setExpanded] = useState(() =>
    selectedDates.some((d) => d >= secondWeekStartYmd),
  )

  const visibleCells = expanded ? allCells : allCells.slice(0, 7)
  const visibleHorizon = expanded ? 14 : 7
  const visibleEndYmd = allCells[visibleHorizon - 1].ymd

  const selectedSet = useMemo(() => new Set(selectedDates), [selectedDates])

  // Range label uses min-max of selectedDates, falling back to the visible window.
  const rangeLabel = useMemo(() => {
    if (selectedDates.length === 0) {
      return formatRangeLabel(todayYmd, visibleEndYmd)
    }
    const sorted = [...selectedDates].sort()
    return formatRangeLabel(sorted[0], sorted[sorted.length - 1])
  }, [selectedDates, todayYmd, visibleEndYmd])

  const renderCell = (cell) => {
    const isSelected = selectedSet.has(cell.ymd)
    const isDisabled = disabledDates.has(cell.ymd)
    const isToday = cell.ymd === todayYmd

    let cls =
      'relative flex flex-col items-center justify-center rounded-xl border py-2 px-1 transition-colors min-h-[56px]'
    if (isDisabled) {
      cls += ' bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed opacity-60'
    } else if (isSelected) {
      cls += ' bg-brand-500 border-brand-500 text-white shadow-sm'
    } else {
      cls += ' bg-white border-cream-200 text-gray-700 hover:border-brand-300'
    }
    if (isToday) cls += ' ring-2 ring-brand-400'

    return (
      <button
        key={cell.ymd}
        type="button"
        onClick={() => !isDisabled && onToggle(cell.ymd)}
        disabled={isDisabled}
        aria-label={
          isDisabled
            ? `${cell.weekday} ${cell.dayNum} — Already planned in another period`
            : `${cell.weekday} ${cell.dayNum}`
        }
        aria-pressed={isSelected}
        data-testid={`date-strip-cell-${cell.ymd}`}
        data-selected={isSelected ? 'true' : 'false'}
        data-disabled={isDisabled ? 'true' : 'false'}
        data-today={isToday ? 'true' : 'false'}
        className={cls}
      >
        <span
          className={`text-[9px] font-bold uppercase tracking-wider ${
            isSelected ? 'text-white/80' : 'text-gray-400'
          }`}
        >
          {cell.weekday}
        </span>
        <span className="text-base font-bold leading-none mt-0.5">
          {cell.dayNum}
        </span>
        {isDisabled && (
          <Slash
            size={20}
            strokeWidth={1.5}
            className="absolute text-gray-300 pointer-events-none"
            aria-hidden="true"
          />
        )}
      </button>
    )
  }

  const firstWeek = visibleCells.slice(0, 7)
  const secondWeek = expanded ? visibleCells.slice(7, 14) : []

  return (
    <div
      className="bg-white border border-cream-200 rounded-2xl px-4 py-4 mb-3 shadow-sm"
      data-testid="date-strip-picker"
    >
      <p className="text-[10px] font-bold text-gray-400 tracking-widest mb-3 uppercase">
        Pick the dates you want to plan
      </p>

      <div className="grid grid-cols-7 gap-1.5" data-testid="date-strip-row-1">
        {firstWeek.map(renderCell)}
      </div>

      {expanded && (
        <div className="grid grid-cols-7 gap-1.5 mt-1.5" data-testid="date-strip-row-2">
          {secondWeek.map(renderCell)}
        </div>
      )}

      <div className="flex items-center justify-between mt-3">
        <p
          className="text-[11px] text-gray-500 leading-tight"
          data-testid="date-strip-summary"
        >
          <span className="font-semibold text-gray-700">
            {selectedDates.length}
          </span>{' '}
          of {visibleHorizon} days selected
          {selectedDates.length > 0 && (
            <>
              <span className="text-gray-300"> · </span>
              {rangeLabel}
            </>
          )}
        </p>
        {expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-[11px] font-semibold text-gray-500 hover:text-brand-600 transition-colors"
            data-testid="date-strip-collapse"
          >
            Hide second week
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-[11px] font-bold text-brand-600 bg-brand-50 border border-brand-200 rounded-full px-3 py-1 hover:bg-brand-100 transition-colors"
            data-testid="date-strip-expand"
          >
            Show another 7 days
          </button>
        )}
      </div>
    </div>
  )
}
