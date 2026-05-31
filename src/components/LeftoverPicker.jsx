import { useMemo, useState } from 'react'
import { ChevronLeft, Check, Sparkles } from 'lucide-react'

function parseIso(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

// Defensive guard: a leftover without a scheduled_date can't be displayed as
// a date, but it also shouldn't crash the picker. Callers can render '—' (or
// hide the row entirely) when this returns ''. Sister fix to the `is_shortlisted`
// filter in fetchCurrentLeftovers + the current_leftovers view migration.
function formatShortDate(iso) {
  if (!iso) return ''
  return parseIso(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function daysBetweenInclusive(startIso, endIso) {
  const start = parseIso(startIso).getTime()
  const end = parseIso(endIso).getTime()
  return Math.round((end - start) / 86400000) + 1
}

/**
 * LeftoverPicker
 *
 * Post-date-picker, pre-confirm screen. User ticks which leftovers to pull
 * into the freshly-chosen period. Defaults to all-selected.
 *
 * If fewer period days are available than selected leftovers, surfaces the
 * overflow count so the user can adjust — the actual drop happens in
 * startNewPeriod (which slices after sequence-assignment).
 *
 * @param {{
 *   leftovers: Array<{ id: string, name: string, is_wildcard: boolean, scheduled_date: string, source_url: string | null }>,
 *   periodStart: string,
 *   periodEnd: string,
 *   onBack: () => void,
 *   onConfirm: (selectedIds: string[]) => void,
 * }} props
 */
export default function LeftoverPicker({
  leftovers,
  periodStart,
  periodEnd,
  onBack,
  onConfirm,
}) {
  // Default: every leftover checked on first render. Using a Set for O(1)
  // toggle without rebuilding an object each time.
  const [selected, setSelected] = useState(
    () => new Set(leftovers.map((l) => l.id)),
  )

  const daysAvailable = useMemo(
    () => daysBetweenInclusive(periodStart, periodEnd),
    [periodStart, periodEnd],
  )

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedCount = selected.size
  const droppedCount = Math.max(0, selectedCount - daysAvailable)

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[55] flex items-end sm:items-center justify-center"
      data-testid="leftover-picker"
    >
      <div className="w-full max-w-sm bg-cream-50 rounded-t-3xl sm:rounded-3xl px-6 pt-6 pb-8 shadow-2xl border-t border-cream-200 max-h-[90vh] flex flex-col">
        <p className="section-heading text-brand-700 mb-1">
          Roll Forward
        </p>
        <p className="text-base font-serif italic text-gray-700 mb-4">
          Pull leftovers into {formatShortDate(periodStart)} – {formatShortDate(periodEnd)}?
        </p>

        <div className="flex-1 overflow-y-auto bg-white border border-cream-100 rounded-2xl divide-y divide-cream-50 shadow-sm mb-4">
          {leftovers.map((item) => {
            const checked = selected.has(item.id)
            return (
              <label
                key={item.id}
                className="flex items-center gap-3 px-4 py-3 min-h-[44px] cursor-pointer"
                data-testid="leftover-row"
              >
                <span
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                    checked
                      ? 'bg-brand-700 border-brand-700'
                      : 'bg-white border-gray-500'
                  }`}
                  aria-hidden="true"
                >
                  {checked && <Check size={12} className="text-white" strokeWidth={3} />}
                </span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  className="sr-only"
                  aria-label={`Include ${item.name}`}
                />
                <span className="text-sm font-bold text-brand-700 w-12 shrink-0 tracking-tighter uppercase">
                  {formatShortDate(item.scheduled_date)}
                </span>
                <span className="text-base flex-1 text-gray-900 font-medium leading-snug flex items-center gap-2">
                  {item.name}
                  {item.is_wildcard && (
                    <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-1 rounded uppercase tracking-tighter shadow-sm flex items-center gap-1">
                      <Sparkles size={10} />
                      New
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>

        <p
          className="text-sm text-center text-gray-700 mb-4"
          data-testid="leftover-counter"
        >
          {selectedCount} selected / {daysAvailable} day{daysAvailable === 1 ? '' : 's'} available.
          {droppedCount > 0 && (
            <span className="text-red-700 font-semibold">
              {' '}
              {droppedCount} will be dropped.
            </span>
          )}
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="btn-secondary inline-flex items-center justify-center gap-1 w-auto px-4"
            data-testid="leftover-back"
          >
            <ChevronLeft size={16} /> Back
          </button>
          <button
            onClick={() => onConfirm(Array.from(selected))}
            className="flex-1 btn-primary"
            data-testid="leftover-confirm"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
