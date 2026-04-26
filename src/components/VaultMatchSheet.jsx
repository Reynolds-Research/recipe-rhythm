import { Sheet } from 'react-modal-sheet'
import { BookOpen, X } from 'lucide-react'
import { useHaptics } from '../hooks/useHaptics'

/**
 * VaultMatchSheet
 * Disambiguation surface for the meals → vault link (PRD-001 P0.3).
 * Renders when a fresh meal log fuzzy-matches multiple vault recipes; the user
 * picks one or "None of these". The chosen vault id is passed back via onSelect
 * (null = none).
 */
export default function VaultMatchSheet({
  isOpen,
  matches = [],
  mealName = '',
  onSelect,
  onClose,
}) {
  const { trigger } = useHaptics()

  const handlePick = (vaultId) => {
    trigger('light')
    onSelect?.(vaultId)
  }

  return (
    <Sheet isOpen={isOpen} onClose={onClose}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 pt-2 pb-safe" role="dialog" aria-label="Pick a Cookbook recipe">
            <p className="text-[11px] font-bold text-brand-500 tracking-widest mb-1 uppercase">
              Did you mean…?
            </p>
            <p className="text-base font-serif italic text-gray-700 mb-5 truncate">
              {mealName}
            </p>

            <div className="divide-y divide-cream-100 max-h-80 overflow-y-auto">
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handlePick(m.id)}
                  className="w-full flex items-center gap-3 py-3 text-left active:bg-brand-50 transition-colors"
                >
                  {m.image_url ? (
                    <img
                      src={m.image_url}
                      alt=""
                      className="w-12 h-12 rounded-xl object-cover flex-shrink-0 bg-cream-100"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
                      <BookOpen size={18} className="text-brand-400" />
                    </div>
                  )}
                  <span className="text-sm text-gray-900 font-medium flex-1 min-w-0 truncate">
                    {m.name}
                  </span>
                </button>
              ))}
            </div>

            <button
              onClick={() => handlePick(null)}
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-cream-200 bg-white text-sm font-semibold text-gray-500 hover:bg-cream-100 transition-colors"
            >
              <X size={14} />
              None of these
            </button>
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}
