import { RefreshCw, Plus } from 'lucide-react'
import { DndContext, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import DateStripPicker from '../../components/DateStripPicker'
import SortableMealItem from './SortableMealItem'

function shortWeekday(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })
}

function shortDateLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

// PRD-002 P0.7: a single day's worth of the grid.
//   - 0 items: the whole cell is a tap-target (placeholder + Plus icon).
//   - 1+ items: each item renders as a card; a "+" button below opens the
//     picker for adding another meal to that day.
// Tapping an existing meal card is intentionally NOT a picker trigger.
function DayCell({ date, items, isServed, onOpenPicker, onToggleCooked, onMoveToMaybe }) {
  const dow = shortWeekday(date)
  const dateLabel = shortDateLabel(date)

  if (items.length === 0) {
    return (
      <div className="py-3">
        <div className="flex items-start gap-3">
          <span className="text-sm font-bold text-brand-700 w-8 flex-shrink-0 tracking-tighter uppercase pt-3">
            {dow}
          </span>
          <button
            type="button"
            role="button"
            aria-label={`Schedule a meal for ${dateLabel}`}
            onClick={() => onOpenPicker(date)}
            className="flex-1 flex items-center justify-center gap-2 py-4 rounded-xl border border-dashed border-cream-200 text-gray-700 hover:text-brand-700 hover:border-brand-200 hover:bg-brand-50/30 transition-colors min-h-[44px]"
          >
            <Plus size={16} strokeWidth={2.5} />
            <span className="text-sm italic">Tap to add a meal</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="py-2">
      <div className="flex items-start gap-3">
        <span className="text-sm font-bold text-brand-700 w-8 flex-shrink-0 tracking-tighter uppercase pt-4">
          {dow}
        </span>
        <div className="flex-1 min-w-0">
          {items.map((slot) => (
            <SortableMealItem
              key={slot.item_id ?? `${slot.scheduled_date}-${slot.name}`}
              slot={slot}
              isServed={isServed}
              onToggleCooked={isServed ? onToggleCooked : null}
              onMoveToMaybe={isServed ? onMoveToMaybe : null}
            />
          ))}
          <button
            type="button"
            role="button"
            aria-label={`Add another meal to ${dateLabel}`}
            onClick={() => onOpenPicker(date)}
            className="btn-text"
          >
            <Plus size={14} strokeWidth={2.5} />
            Add another meal
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MealPlanCard({
  isServed,
  selectedDates,
  disabledDates,
  dayGridDates,
  itemsByDate,
  plan,
  sensors,
  onToggleDate,
  onRegenerate,
  onDragEnd,
  onOpenPicker,
  onToggleCooked,
  onMoveToMaybe,
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="section-heading">Your meal plan</p>
        <button
          onClick={onRegenerate}
          disabled={isServed}
          className={`btn-text ${isServed ? 'text-gray-500 cursor-not-allowed pointer-events-none' : ''}`}
        >
          <RefreshCw size={14} strokeWidth={2.5} />
          Regenerate
        </button>
      </div>

      {!isServed && (
        <DateStripPicker
          selectedDates={selectedDates}
          disabledDates={disabledDates}
          onToggle={onToggleDate}
        />
      )}

      <div className="bg-white border border-cream-100 rounded-2xl px-5 shadow-sm overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={plan.map(s => s.scheduled_date)}
            strategy={verticalListSortingStrategy}
          >
            <div className="divide-y divide-cream-50">
              {dayGridDates.length === 0 ? (
                <p className="py-6 helper-text text-center">
                  Pick a date above to start planning.
                </p>
              ) : (
                dayGridDates.map((date) => (
                  <DayCell
                    key={date}
                    date={date}
                    items={itemsByDate.get(date) ?? []}
                    isServed={isServed}
                    onOpenPicker={onOpenPicker}
                    onToggleCooked={onToggleCooked}
                    onMoveToMaybe={onMoveToMaybe}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}
