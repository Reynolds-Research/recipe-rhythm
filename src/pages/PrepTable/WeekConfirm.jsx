import { useState } from 'react'
import { Check, Loader2, ShoppingCart } from 'lucide-react'
import { formatLocalDate } from '../../lib/dateUtils'
import { dateLabel } from './labels'

/** "Tue Nov 10", "Tue Nov 10 and Thu Nov 12", "Mon, Tue and Thu" style list. */
function listDays(dates) {
  const names = dates.map((d) => `${dateLabel(d).weekday} ${dateLabel(d).monthDay}`)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * "Changed since you confirmed" — shown at the top of a confirmed week after
 * a meal in it was added, removed, renamed or moved (PRD-008 §4.5). An offer,
 * never a block: she can update the list or keep it.
 */
export function ChangedBanner({ busy, onUpdate, onKeep }) {
  return (
    <section aria-label="Changed since you confirmed"
      className="rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
      <p className="text-sm font-semibold text-amber-900">
        This week changed since you confirmed it. Update the grocery list?
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onUpdate} disabled={busy} className="btn-primary flex-1 py-3">
          Update list
        </button>
        <button type="button" onClick={onKeep} disabled={busy} className="btn-secondary flex-1 py-3">
          Keep as is
        </button>
      </div>
    </section>
  )
}

/**
 * The end of the week: "Confirm the week" (her final say, PRD-008 goal 3),
 * then the confirmed stamp and the grocery list.
 *
 * Empty nights are told, never blocking (§4.4): with an empty day still
 * showing, the first tap explains and offers "Confirm anyway" / "Not yet".
 */
export default function WeekConfirm({
  confirmation, canConfirm, emptyDays = [], busy, making, notice,
  onConfirm, onMakeList, onOpenList,
}) {
  const [asking, setAsking] = useState(false)

  if (making) {
    return (
      <div role="status" className="card p-4 flex items-center justify-center gap-2 text-gray-900">
        <Loader2 size={18} className="animate-spin text-brand-600" aria-hidden="true" />
        <span className="font-medium">Making the grocery list…</span>
      </div>
    )
  }

  if (confirmation) {
    const on = dateLabel(formatLocalDate(new Date(confirmation.confirmed_at)))
    return (
      <section aria-label="Week confirmed" className="card p-4 space-y-3">
        <p className="flex items-center gap-2 font-semibold text-gray-900">
          <span className="w-6 h-6 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0">
            <Check size={14} strokeWidth={3} aria-hidden="true" />
          </span>
          Confirmed {on.weekday} {on.monthDay}
        </p>
        {notice && <p className="helper-text">{notice}</p>}
        {confirmation.grocery_list_id ? (
          <button type="button" onClick={onOpenList} disabled={busy}
            className="btn-secondary py-3 flex items-center justify-center gap-2">
            <ShoppingCart size={18} aria-hidden="true" /> Grocery list
          </button>
        ) : (
          <button type="button" onClick={onMakeList} disabled={busy}
            className="btn-secondary py-3 flex items-center justify-center gap-2">
            <ShoppingCart size={18} aria-hidden="true" /> Make the grocery list
          </button>
        )}
      </section>
    )
  }

  if (!canConfirm) return null

  if (asking && emptyDays.length > 0) {
    const one = emptyDays.length === 1
    return (
      <section aria-label="Confirm the week" className="card p-4 space-y-3">
        <p className="text-sm text-gray-900">
          {listDays(emptyDays)} {one ? 'has' : 'have'} no meal yet. The grocery list will skip {one ? 'it' : 'them'}.
        </p>
        <div className="flex gap-2">
          <button type="button" disabled={busy} className="btn-primary flex-1 py-3"
            onClick={() => { setAsking(false); onConfirm() }}>
            Confirm anyway
          </button>
          <button type="button" onClick={() => setAsking(false)} className="btn-secondary flex-1 py-3">
            Not yet
          </button>
        </div>
      </section>
    )
  }

  return (
    <button type="button" disabled={busy} className="btn-primary py-3 flex items-center justify-center gap-2"
      onClick={() => (emptyDays.length > 0 ? setAsking(true) : onConfirm())}>
      <Check size={18} aria-hidden="true" /> Confirm the week
    </button>
  )
}
