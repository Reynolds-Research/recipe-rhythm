import { Check, Plus, Sparkles, X, ArrowRightLeft, RefreshCw, GripVertical } from 'lucide-react'
import { useDndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { dateLabel } from './labels'
import { dayDropId, mealDragId, slotDropId } from './dragDrop'

/**
 * One planned meal, which can be picked up and dropped on another day — and
 * is itself a drop target: drop another meal on it and the two swap.
 * The whole card is the handle for mouse and touch (press and hold), like
 * the old Prep Table. Keyboard dragging starts only from the grip, so Space
 * / Enter on the buttons inside still press those buttons.
 */
function DraggableMeal({ meal, isPast, isToday, busy, onToggleCooked, onMove, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: mealDragId(meal.id),
    disabled: busy,
  })
  const { onKeyDown, ...pointerListeners } = listeners ?? {}
  // The card is also a drop target: dropping another meal here swaps the two.
  const { setNodeRef: setDropRef, isOver: swapHere } = useDroppable({ id: slotDropId(meal.id) })
  const setRefs = (node) => { setNodeRef(node); setDropRef(node) }
  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: isDragging ? 50 : undefined,
    WebkitTouchCallout: 'none', // long-press drags; no iOS callout menu
  }
  return (
    <div
      ref={setRefs}
      style={style}
      {...pointerListeners}
      data-testid={`meal-${meal.id}`}
      data-swap-target={(swapHere && !isDragging) || undefined}
      className={`relative flex items-center gap-1 rounded-xl px-1 py-1 min-h-[48px] select-none cursor-grab active:cursor-grabbing border-2 transition-[background-color,border-color,box-shadow] ${
        isDragging ? 'border-brand-500 bg-brand-50 shadow-lg'
          : swapHere ? 'border-dashed border-brand-500 bg-brand-50'
          : 'border-transparent bg-cream-50'
      }`}
    >
      <span
        {...attributes}
        onKeyDown={onKeyDown}
        aria-label={`Drag ${meal.name} to another day`}
        className="w-11 h-11 shrink-0 flex items-center justify-center text-gray-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <GripVertical size={20} strokeWidth={2.25} />
      </span>
      {(isPast || isToday) && (
        <button
          type="button"
          role="checkbox"
          aria-checked={meal.cooked}
          aria-label={`Cooked ${meal.name}`}
          disabled={busy}
          onClick={() => onToggleCooked(meal)}
          className="w-11 h-11 shrink-0 flex items-center justify-center"
        >
          <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
            meal.cooked ? 'bg-brand-600 border-brand-600 text-white' : 'border-cream-200 bg-white text-transparent'
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
  )
}

/**
 * While a meal is dragged over this day: the name of the meal it would swap
 * with (the card under the pointer, or the day's only meal), else null. Shown
 * in the day's header because the dragged card covers the target card itself.
 */
function swapTargetName({ active, over }, date, meals) {
  if (!active || !over) return null
  const dragged = String(active.id).replace(/^meal:/, '')
  const target = String(over.id)
  if (target.startsWith('slot:')) {
    const m = meals.find((x) => x.id === target.slice(5))
    return m && m.id !== dragged ? m.name : null
  }
  if (target === dayDropId(date) && meals.length === 1 && meals[0].id !== dragged) return meals[0].name
  return null
}

/**
 * One day of the week: its meals, or for an empty day "+ add" and "✨ suggest".
 * Must sit inside the page's <DndContext>: meals can be dragged onto any day.
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
  // The whole day is a drop target; it lights up while a meal hovers over it.
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(date) })
  const swapName = swapTargetName(useDndContext(), date, meals)

  return (
    <section
      ref={setNodeRef}
      aria-label={`${weekday} ${monthDay}`}
      data-date={date}
      data-drop-over={isOver || undefined}
      className={`card p-3 space-y-2 transition-colors ${isOver ? 'border-2 border-dashed border-brand-400 bg-brand-50' : ''}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-bold text-gray-900">
          {weekday} <span className="font-medium text-gray-700">{monthDay}</span>
          {isToday && <span className="ml-2 text-xs font-bold uppercase tracking-wider text-brand-700">Today</span>}
        </h3>
        {swapName && (
          <span className="text-sm font-semibold text-brand-700" data-testid="swap-hint">⇄ Swap with {swapName}</span>
        )}
        {!empty && !swapName && (
          <button type="button" onClick={onAdd} disabled={busy} aria-label={`Add another meal on ${weekday}`}
            className="btn-icon shadow-none">
            <Plus size={18} />
          </button>
        )}
      </header>

      {meals.map((meal) => (
        <DraggableMeal key={meal.id} meal={meal} isPast={isPast} isToday={isToday} busy={busy}
          onToggleCooked={onToggleCooked} onMove={onMove} onRemove={onRemove} />
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
