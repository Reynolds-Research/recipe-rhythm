import { GripVertical, Sparkles, ExternalLink, BookmarkPlus } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// PRD-002 P0.7: per-day card. The legacy Swap button has been removed — the
// day picker (tap on the day cell or its "+") is the new way to browse vault
// + AI candidates. Move-to-Maybe stays for scheduled rows. Tapping the meal
// card itself is intentionally a no-op (per acceptance criterion #3).
export default function SortableMealItem({ slot, isServed, onToggleCooked, onMoveToMaybe }) {
  const showCookedToggle = isServed && !!onToggleCooked && !!slot.item_id
  // PRD-002 P0.6: only allow Move-to-Maybe on rows that exist in DB (item_id
  // present) — pre-serve plan slots are local-only and have no FK target.
  const canMoveToMaybe = isServed && !!onMoveToMaybe && !!slot.item_id
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: slot.scheduled_date, disabled: isServed })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
    // Long-press is the touch drag gesture; stop iOS from opening its
    // callout / text-selection menu on the same press.
    WebkitTouchCallout: isServed ? undefined : 'none',
  }

  // Pre-serve, the whole card is the drag handle (the grip alone was too
  // small to find on a phone). Served plans are locked, so no grip is shown.
  let dragState = 'border-cream-200 bg-white'
  if (isDragging) dragState = 'border-brand-500 bg-brand-50 shadow-lg scale-[1.03] relative'
  else if (isOver) dragState = 'border-dashed border-brand-400 bg-brand-50'

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(isServed ? {} : listeners)}
      className={
        isServed
          ? 'flex items-center gap-3 py-3 bg-white'
          : `flex items-center gap-3 my-2 pr-3 min-h-[56px] rounded-xl border-2 select-none cursor-grab active:cursor-grabbing transition-[background-color,border-color,box-shadow,scale] ${dragState}`
      }
    >
      {!isServed && (
        <div
          {...attributes}
          aria-label={`Drag ${slot.name} to another day`}
          className="w-11 h-11 flex items-center justify-center text-gray-700 shrink-0"
        >
          <GripVertical size={24} strokeWidth={2.25} />
        </div>
      )}
      <span
        className={`flex-1 min-w-0 font-medium leading-snug flex flex-col items-start gap-1 text-base ${
          showCookedToggle && slot.cooked
            ? 'line-through text-gray-500'
            : 'text-gray-900'
        }`}
      >
        <span className="line-clamp-2 w-full break-words">{slot.name}</span>
        {slot.is_wildcard && (
          <div className="flex items-center gap-2">
            <span className="bg-brand-100 text-brand-600 text-xs font-bold px-2 py-1 rounded uppercase tracking-tighter shadow-sm flex items-center gap-1">
              <Sparkles size={10} />
              New
            </span>
            {slot.source_url && (
              <a
                href={slot.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700 transition-colors"
                title="View Recipe"
                aria-label={`View recipe for ${slot.name}`}
              >
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        )}
      </span>
      {canMoveToMaybe && (
        <button
          onClick={() => onMoveToMaybe(slot.item_id)}
          aria-label="Move to Maybe"
          title="Move to Maybe"
          className="shrink-0 w-11 h-11 -mr-2 flex items-center justify-center text-brand-600 hover:text-brand-700 transition-colors"
        >
          <BookmarkPlus size={18} strokeWidth={2} />
        </button>
      )}
      {showCookedToggle && (
        <label className="shrink-0 flex items-center gap-2 cursor-pointer">
          <span className="text-sm font-bold text-brand-600 uppercase tracking-wide">
            Cooked
          </span>
          <input
            type="checkbox"
            checked={!!slot.cooked}
            onChange={(e) => onToggleCooked(slot.item_id, e.target.checked)}
            aria-label={`Mark "${slot.name}" cooked`}
            style={{ accentColor: '#D74520' }}
            className="h-5 w-5 rounded border-cream-200 focus:ring-brand-300 focus:ring-2"
          />
        </label>
      )}
    </div>
  )
}
