import { Sheet } from 'react-modal-sheet'
import { X, Bookmark } from 'lucide-react'
import { dateLabel } from './labels'

/**
 * "Which day?" — used to put a Maybe or "Didn't get to these" meal on a day,
 * and to move a planned meal. Offers the days this week shows; optionally
 * "Maybe list" too (when moving a planned meal off its day).
 *
 * @param {{
 *   meal: object | null, dates: string[], today: string, allowMaybe?: boolean,
 *   onChoose: (date: string | null) => void, onClose: () => void,
 * }} props
 */
export default function DayChoiceSheet({ meal, dates = [], today, allowMaybe = false, onChoose, onClose }) {
  const isOpen = meal != null
  const choices = dates.filter((d) => d !== meal?.planned_on)
  return (
    <Sheet isOpen={isOpen} onClose={onClose} snapPoints={[0, 0.6, 1]} initialSnap={1}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 py-2 pb-safe space-y-3" data-testid="day-choice-sheet">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-heading text-brand-700">Which day?</p>
                <p className="text-lg font-semibold text-gray-900">{meal?.name}</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="btn-icon"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {choices.map((d) => {
                const { weekday, monthDay } = dateLabel(d)
                return (
                  <button key={d} type="button" onClick={() => onChoose(d)}
                    className={`chip justify-center ${d < today ? 'text-gray-700' : ''}`}>
                    {weekday} {monthDay}
                  </button>
                )
              })}
              {allowMaybe && meal?.planned_on && (
                <button type="button" onClick={() => onChoose(null)} className="chip justify-center col-span-2">
                  <Bookmark size={16} aria-hidden="true" /> Maybe list
                </button>
              )}
            </div>
            {choices.length === 0 && !allowMaybe && (
              <p className="helper-text">No days showing this week. Turn a day on first.</p>
            )}
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}
