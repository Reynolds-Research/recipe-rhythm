import { Sheet } from 'react-modal-sheet'
import { Sparkles, Check, X } from 'lucide-react'
import { useHaptics } from '../hooks/useHaptics'

/**
 * MealNameConfirmSheet
 * Shown after the user submits a meal/recipe name and the spell-check API
 * returns a different value (typo fix or casing change). The user accepts the
 * suggestion or keeps their original — either way the form proceeds with the
 * chosen value. Used by Vault add and LogMode save.
 */
export default function MealNameConfirmSheet({
  isOpen,
  original = '',
  corrected = '',
  onAccept,
  onReject,
  onClose,
}) {
  const { trigger } = useHaptics()

  const accept = () => {
    trigger('light')
    onAccept?.()
  }
  const reject = () => {
    trigger('light')
    onReject?.()
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 pt-2 pb-safe" role="dialog" aria-label="Confirm spelling">
            <p className="text-[11px] font-bold text-brand-500 tracking-widest mb-3 uppercase flex items-center gap-1.5">
              <Sparkles size={12} />
              Did you mean…?
            </p>

            <div className="space-y-3 mb-5">
              <div className="rounded-2xl border border-cream-200 bg-white p-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">You typed</p>
                <p className="text-sm text-gray-500 line-through">{original}</p>
              </div>
              <div className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4">
                <p className="text-[10px] font-bold text-brand-500 uppercase tracking-wider mb-1">Suggested</p>
                <p className="text-base font-medium text-gray-900">{corrected}</p>
              </div>
            </div>

            <button
              onClick={accept}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 transition-colors"
            >
              <Check size={16} />
              Use suggestion
            </button>
            <button
              onClick={reject}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-cream-200 bg-white text-sm font-semibold text-gray-500 hover:bg-cream-100 transition-colors"
            >
              <X size={14} />
              Keep my version
            </button>
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}
