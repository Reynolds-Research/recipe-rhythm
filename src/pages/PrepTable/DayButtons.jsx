import { useState } from 'react'
import { DAY_LABELS, canHideDay, shownDays } from '../../lib/weekRange'

const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * The Su–Sa row at the top of the week (PRD-008 D8, option B). Tap a day to
 * show or hide it for this week. A day with a meal on it is locked on: it has
 * a dashed outline, and tapping it explains why instead of hiding it.
 *
 * @param {{ dayArgs: object, onToggle: (day: number) => void, disabled?: boolean }} props
 */
export default function DayButtons({ dayArgs, onToggle, disabled = false }) {
  const shown = shownDays(dayArgs)
  const [lockedTap, setLockedTap] = useState(null)   // the day just tapped while locked
  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Days this week shows" className="flex gap-1.5">
        {DAY_LABELS.map((label, day) => {
          const on = shown.includes(day)
          const locked = on && !canHideDay(day, dayArgs)
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              aria-label={`${FULL[day]}${locked ? ' (has a meal, always shown)' : ''}`}
              aria-disabled={locked || undefined}
              disabled={disabled}
              onClick={() => {
                if (locked) { setLockedTap(day); return }
                setLockedTap(null)
                onToggle(day)
              }}
              className={`flex-1 min-h-[44px] rounded-xl text-sm font-semibold border-2 transition-colors ${
                on
                  ? 'bg-brand-700 border-brand-700 text-white'
                  : 'bg-white border-cream-200 text-gray-700 hover:border-brand-400'
              } ${locked ? 'outline-2 outline-dashed outline-white -outline-offset-4' : ''}`}
            >
              {label}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-gray-700" role="status">
        {lockedTap != null && shown.includes(lockedTap) && !canHideDay(lockedTap, dayArgs)
          ? `${FULL[lockedTap]} has a meal on it. Move or remove the meal to hide the day.`
          : 'Tap a day to show or hide it. Next week starts with the same days.'}
      </p>
    </div>
  )
}
