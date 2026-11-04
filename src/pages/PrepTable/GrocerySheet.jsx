import { Sheet } from 'react-modal-sheet'
import { Loader2, X } from 'lucide-react'
import { GROCERY_SECTIONS } from '../../lib/constants'

/**
 * The confirmed week's grocery list, by store section (PRD-008 P0.6).
 * Read-only for now: sharing and adding your own items stay on the Groceries
 * tab, which moves to confirmed weeks at the switch-over (2c).
 *
 * @param {{
 *   open: boolean, loading: boolean, failed?: boolean, items: object[],
 *   leftOff: string[], onClose: () => void,
 * }} props
 */
export default function GrocerySheet({ open, loading, failed = false, items = [], leftOff = [], onClose }) {
  return (
    <Sheet isOpen={open} onClose={onClose} snapPoints={[0, 0.85, 1]} initialSnap={1}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 py-2 pb-safe space-y-4" data-testid="grocery-sheet">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-gray-900">This week’s groceries</p>
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
            {!loading && !failed && items.length === 0 && (
              <p className="helper-text">The list is empty.</p>
            )}

            {!loading && !failed && GROCERY_SECTIONS.map((section) => {
              const inSection = items.filter((i) => i.section === section)
              if (inSection.length === 0) return null
              return (
                <section key={section} aria-label={section}>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="section-heading">{section}</p>
                    <div className="flex-1 h-px bg-cream-200" />
                  </div>
                  <ul className="space-y-2">
                    {inSection.map((item) => (
                      <li key={item.id} className="flex items-baseline justify-between gap-3 py-1">
                        <span className="body-text">{item.name}</span>
                        {item.quantity && <span className="helper-text shrink-0">{item.quantity}</span>}
                      </li>
                    ))}
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
