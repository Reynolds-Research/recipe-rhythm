import { Check, Plus, Sparkles, X, ArrowRightLeft, RefreshCw } from 'lucide-react'
import { dateLabel } from './labels'

/**
 * One day of the week: its meals, or for an empty day "+ add" and "✨ suggest".
 * A ✨ proposal shows dashed with ✓ (save it) / ↻ (another) / ✕ (not this) —
 * it isn't saved until ✓ (D3). Past days read as history: cooked or not.
 */
export default function DayRow({
  date,
  today,
  meals = [],
  proposal = null,
  canSuggest = true,
  busy = false,
  onAdd,
  onSuggest,
  onAccept,
  onDismiss,
  onToggleCooked,
  onMove,
  onRemove,
}) {
  const { weekday, monthDay } = dateLabel(date)
  const isPast = date < today
  const isToday = date === today
  const empty = meals.length === 0

  return (
    <section aria-label={`${weekday} ${monthDay}`} data-date={date} className="card p-3 space-y-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">
          {weekday} <span className="font-medium text-gray-700">{monthDay}</span>
          {isToday && <span className="ml-2 text-xs font-bold uppercase tracking-wider text-brand-700">Today</span>}
        </h3>
        {!empty && (
          <button type="button" onClick={onAdd} disabled={busy} aria-label={`Add another meal on ${weekday}`}
            className="btn-icon shadow-none">
            <Plus size={18} />
          </button>
        )}
      </header>

      {meals.map((meal) => (
        <div key={meal.id} className="flex items-center gap-2 rounded-xl bg-cream-50 px-3 py-2 min-h-[48px]">
          {(isPast || isToday) && (
            <button
              type="button"
              role="checkbox"
              aria-checked={meal.cooked}
              aria-label={`Cooked ${meal.name}`}
              disabled={busy}
              onClick={() => onToggleCooked(meal)}
              className="w-11 h-11 -ml-2 shrink-0 flex items-center justify-center"
            >
              <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                meal.cooked ? 'bg-green-700 border-green-700 text-white' : 'border-cream-200 bg-white text-transparent'
              }`}>
                <Check size={16} strokeWidth={3} />
              </span>
            </button>
          )}
          <span className={`flex-1 min-w-0 font-medium ${isPast && !meal.cooked ? 'text-gray-700' : 'text-gray-900'}`}>
            {meal.name}
            {isPast && !meal.cooked && <span className="block text-xs text-gray-700">Not cooked</span>}
          </span>
          <button type="button" onClick={() => onMove(meal)} disabled={busy} aria-label={`Move ${meal.name}`}
            className="w-11 h-11 flex items-center justify-center text-gray-700 hover:text-brand-700">
            <ArrowRightLeft size={16} />
          </button>
          <button type="button" onClick={() => onRemove(meal)} disabled={busy} aria-label={`Remove ${meal.name}`}
            className="w-11 h-11 flex items-center justify-center text-gray-700 hover:text-red-700">
            <X size={18} />
          </button>
        </div>
      ))}

      {empty && proposal && (
        <div className="flex items-center gap-2 rounded-xl border-2 border-dashed border-brand-200 bg-brand-50 px-3 py-2 min-h-[48px]">
          <Sparkles size={16} className="shrink-0 text-brand-700" aria-hidden="true" />
          <span className="flex-1 min-w-0 font-medium text-gray-900">
            {proposal.name}
            <span className="block text-xs text-gray-700">Suggestion · not saved yet</span>
          </span>
          <button type="button" onClick={onAccept} disabled={busy} aria-label={`Keep ${proposal.name}`}
            className="w-11 h-11 rounded-full bg-brand-700 text-white flex items-center justify-center">
            <Check size={18} strokeWidth={3} />
          </button>
          <button type="button" onClick={onSuggest} disabled={busy} aria-label="Suggest something else"
            className="w-11 h-11 flex items-center justify-center text-gray-700 hover:text-brand-700">
            <RefreshCw size={16} />
          </button>
          <button type="button" onClick={onDismiss} disabled={busy} aria-label={`Not ${proposal.name}`}
            className="w-11 h-11 flex items-center justify-center text-gray-700 hover:text-red-700">
            <X size={18} />
          </button>
        </div>
      )}

      {empty && !proposal && (
        <div className="flex gap-2">
          <button type="button" onClick={onAdd} disabled={busy}
            className="flex-1 min-h-[44px] rounded-xl border-2 border-dashed border-cream-200 text-brand-700 font-semibold text-sm">
            + add
          </button>
          {!isPast && (
            <button type="button" onClick={onSuggest} disabled={busy || !canSuggest}
              className="flex-1 min-h-[44px] rounded-xl border-2 border-dashed border-cream-200 text-brand-700 font-semibold text-sm disabled:text-gray-500">
              ✨ suggest
            </button>
          )}
        </div>
      )}
    </section>
  )
}
