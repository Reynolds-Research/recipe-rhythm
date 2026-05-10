import { Bookmark, Trash2 } from 'lucide-react'
import { Sheet } from 'react-modal-sheet'
import { parseYmd, addDays, formatLocalYmd, shortDateLabel } from './useBrainstorm'

// PRD-002 P0.6: the "Maybe" tab view. Renders the shortlist for the active
// period; each item exposes a "Schedule" button that opens the schedule sheet.
// Also owns the Schedule-from-Maybe Sheet (shared scheduleSheetItem state).
export default function MaybeShortlist({
  visible,
  items,
  isServed,
  loadedPlan,
  scheduleSheetItem,
  onOpenSheet,
  onCloseSheet,
  onSchedule,
  onRemove,
  error,
}) {
  return (
    <>
      {visible && (
        <>
          {!isServed && (
            <div className="bg-white border border-cream-100 rounded-2xl px-5 py-8 text-center shadow-sm">
              <p className="helper-text">
                Serve a plan to start shortlisting candidates for the period.
              </p>
            </div>
          )}
          {isServed && items.length === 0 && (
            <div className="bg-white border border-cream-100 rounded-2xl px-5 py-8 text-center shadow-sm">
              <p className="helper-text">
                Nothing shortlisted yet. Tap a candidate's bookmark to save it for later.
              </p>
            </div>
          )}
          {isServed && items.length > 0 && (
            <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
              {items.map((item) => (
                <div
                  key={item.item_id}
                  className="flex items-center gap-3 py-4"
                  data-testid={`shortlist-item-${item.item_id}`}
                >
                  <Bookmark size={16} strokeWidth={2} className="text-brand-700 flex-shrink-0" />
                  <span className="text-base text-gray-900 flex-1 min-w-0 truncate font-medium">
                    {item.name}
                  </span>
                  <button
                    onClick={() => onOpenSheet(item)}
                    aria-label={`Schedule ${item.name}`}
                    className="flex-shrink-0 text-xs font-bold text-brand-700 bg-brand-50 border border-brand-100 rounded-full px-4 py-3 min-h-[44px] uppercase tracking-wide hover:bg-brand-100 transition-colors"
                  >
                    Schedule
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* PRD-002 P0.6: Schedule-from-Maybe — bottom sheet.
          Lists every date in the active period. Selecting a date promotes the
          shortlist row to scheduled (single UPDATE). "Remove" hard-deletes the
          row. */}
      <Sheet
        isOpen={!!scheduleSheetItem}
        onClose={onCloseSheet}
      >
        <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-6 py-2 pb-safe">
              <p className="section-heading text-brand-700 mb-1">
                Schedule from Maybe
              </p>
              <p className="text-base font-serif italic text-gray-700 mb-6">
                {scheduleSheetItem?.name}
              </p>

              <div
                role="list"
                aria-label="Days in period"
                className="divide-y divide-gray-100 max-h-72 overflow-y-auto"
              >
                {(() => {
                  const periodDates = []
                  if (loadedPlan?.period_start && loadedPlan?.period_end) {
                    const start = parseYmd(loadedPlan.period_start)
                    const end = parseYmd(loadedPlan.period_end)
                    let cursor = start
                    while (cursor <= end) {
                      periodDates.push(formatLocalYmd(cursor))
                      cursor = addDays(cursor, 1)
                    }
                  }
                  if (periodDates.length === 0) {
                    return (
                      <p className="helper-text py-4 text-center">
                        No active period.
                      </p>
                    )
                  }
                  return periodDates.map((d) => (
                    <button
                      key={d}
                      role="listitem"
                      onClick={() => onSchedule(scheduleSheetItem, d)}
                      className="w-full text-left py-3 min-h-[44px] text-base text-gray-900 hover:text-brand-700 transition-colors"
                    >
                      {shortDateLabel(d)}
                    </button>
                  ))
                })()}
              </div>

              <button
                onClick={() => onRemove(scheduleSheetItem)}
                className="w-full mt-4 py-3 min-h-[44px] rounded-2xl border border-red-200 text-sm font-semibold text-red-700 bg-red-50 hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 size={16} />
                Remove
              </button>

              <button
                onClick={onCloseSheet}
                className="btn-secondary mt-2"
              >
                Cancel
              </button>
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onClick={onCloseSheet} />
      </Sheet>
    </>
  )
}
