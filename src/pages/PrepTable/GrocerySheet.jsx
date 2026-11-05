import { useState } from 'react'
import { Sheet } from 'react-modal-sheet'
import { ChevronDown, ChevronUp, Loader2, X } from 'lucide-react'
import { GROCERY_SECTIONS } from '../../lib/constants'
import { showRecipeLine, splitList } from '../../lib/groceryAmounts'

const ACTION = 'inline-flex items-center min-h-[44px] text-sm font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50'
const QUIET_ACTION = 'inline-flex items-center min-h-[44px] text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50'

/** "avocado" → "Avocado" (display only; the saved name is untouched). */
function label(name) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name
}

/** One line to buy: name, "Recipes use …" when it differs, and what to buy. */
function ListRow({ item }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-1">
      <span className="flex flex-col">
        <span className="body-text text-gray-900">{label(item.name)}</span>
        {showRecipeLine(item) && (
          <span className="helper-text">Recipes use {item.recipe_quantity}</span>
        )}
      </span>
      {item.quantity && <span className="font-semibold text-gray-900 shrink-0">{item.quantity}</span>}
    </li>
  )
}

/**
 * "Assumed you have": cupboard items this week's recipes use, stated rather
 * than asked (spices last months, so a weekly checklist would be ignored).
 * Collapsed to one line; opened, each item has Add (onto the list) and
 * Always have (into her pantry list, so it never shows again). What she just
 * did stays on screen with Undo until the sheet closes.
 *
 * Mounted fresh each time the list loads, so marks never carry over.
 */
function AssumedGroup({ items, staples, onSetAssumed, onSetAlwaysHave }) {
  const [expanded, setExpanded] = useState(false)
  const [marks, setMarks] = useState({}) // item id → 'added' | 'always'
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)

  const { assumed } = splitList(items, staples, Object.keys(marks))
  if (assumed.length === 0) return null

  const names = assumed.map((i) => label(i.name))
  const summary = names.length > 3
    ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    : names.join(', ')

  const run = async (item, save, mark) => {
    setPending(item.id)
    setError(null)
    try {
      await save()
      setMarks((m) => {
        const next = { ...m }
        if (mark) next[item.id] = mark
        else delete next[item.id]
        return next
      })
    } catch (err) {
      console.error('[GrocerySheet] save failed', err)
      setError("Couldn't save that. Try again.")
    } finally {
      setPending(null)
    }
  }

  return (
    <section aria-label="Assumed you have" className="rounded-xl border border-cream-200 bg-white">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="w-full min-h-[56px] flex items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <span className="flex flex-col">
          <span className="font-semibold text-gray-900">Assumed you have</span>
          <span className="helper-text">
            {expanded ? 'This week’s recipes use these. Out of one? Add it.' : summary}
          </span>
        </span>
        {expanded
          ? <ChevronUp size={16} className="text-gray-700 shrink-0" aria-hidden="true" />
          : <ChevronDown size={16} className="text-gray-700 shrink-0" aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="px-4 pb-2">
          <ul>
            {assumed.map((item) => {
              const mark = marks[item.id]
              const busy = pending === item.id
              return (
                <li key={item.id} className="min-h-[48px] flex items-center justify-between gap-2 border-t border-cream-100">
                  <span className="flex flex-col">
                    <span className={mark ? 'body-text text-gray-600' : 'body-text text-gray-900'}>{label(item.name)}</span>
                    <span className="helper-text">
                      {mark === 'added' && `On the list${item.quantity ? ` · ${item.quantity}` : ''}`}
                      {mark === 'always' && 'Won’t show again · in your pantry list'}
                      {!mark && (item.recipe_quantity ?? '')}
                    </span>
                  </span>
                  {mark ? (
                    <button
                      type="button" disabled={busy} className={ACTION}
                      aria-label={`Undo ${label(item.name)}`}
                      onClick={() => run(item, () => (mark === 'added'
                        ? onSetAssumed(item, true)
                        : onSetAlwaysHave(item, false)), null)}
                    >
                      Undo
                    </button>
                  ) : (
                    <span className="flex gap-4 shrink-0">
                      <button
                        type="button" disabled={busy} className={QUIET_ACTION}
                        aria-label={`Always have ${label(item.name)}`}
                        onClick={() => run(item, () => onSetAlwaysHave(item, true), 'always')}
                      >
                        Always have
                      </button>
                      <button
                        type="button" disabled={busy} className={ACTION}
                        aria-label={`Add ${label(item.name)}`}
                        onClick={() => run(item, () => onSetAssumed(item, false), 'added')}
                      >
                        Add
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          {error && <p role="alert" className="text-sm text-red-800 py-2">{error}</p>}
          {staples.length > 0 && (
            <p className="helper-text border-t border-cream-100 pt-2 pb-1">
              Not shown, in your pantry list: {staples.join(', ')}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * The confirmed week's grocery list, by store section (PRD-008 P0.6).
 * Each line shows what to buy, with what the recipes use under it when that
 * differs; cupboard items sit in "Assumed you have" until she adds one.
 * Sharing and adding your own items stay on the Groceries tab, which moves
 * to confirmed weeks at the switch-over (2c).
 *
 * @param {{
 *   open: boolean, loading: boolean, failed?: boolean, items: object[],
 *   staples?: string[], subtitle?: string|null, leftOff: string[],
 *   onSetAssumed?: (item: object, assumed: boolean) => Promise<void>,
 *   onSetAlwaysHave?: (item: object, on: boolean) => Promise<void>,
 *   onClose: () => void,
 * }} props
 */
export default function GrocerySheet({
  open, loading, failed = false, items = [], staples = [], subtitle = null, leftOff = [],
  onSetAssumed = async () => {}, onSetAlwaysHave = async () => {}, onClose,
}) {
  const { onList } = splitList(items, staples)
  const ready = !loading && !failed

  return (
    <Sheet isOpen={open} onClose={onClose} snapPoints={[0, 0.85, 1]} initialSnap={1}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 py-2 pb-safe space-y-4" data-testid="grocery-sheet">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <p className="text-lg font-semibold text-gray-900">This week’s groceries</p>
                {subtitle && <p className="helper-text">{subtitle}</p>}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="btn-icon"><X size={18} /></button>
            </div>

            {loading && (
              <div className="flex justify-center py-8" role="status" aria-label="Loading the grocery list">
                <Loader2 className="animate-spin text-brand-700" />
              </div>
            )}
            {!loading && failed && (
              <p className="text-sm text-red-800">Couldn’t load the grocery list. Close and try again.</p>
            )}
            {ready && items.length === 0 && (
              <p className="helper-text">The list is empty.</p>
            )}

            {ready && open && (
              <AssumedGroup
                items={items}
                staples={staples}
                onSetAssumed={onSetAssumed}
                onSetAlwaysHave={onSetAlwaysHave}
              />
            )}

            {ready && GROCERY_SECTIONS.map((section) => {
              const inSection = onList.filter((i) => i.section === section)
              if (inSection.length === 0) return null
              return (
                <section key={section} aria-label={section}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="section-heading">{section}</p>
                    <div className="flex-1 h-px bg-cream-200" />
                  </div>
                  <ul className="space-y-2">
                    {inSection.map((item) => <ListRow key={item.id} item={item} />)}
                  </ul>
                </section>
              )
            })}

            {!loading && leftOff.length > 0 && (
              <p className="helper-text border-t border-cream-200 pt-3">
                Not on the list (not in your Cookbook): {leftOff.join(', ')}.
              </p>
            )}
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}
