import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useHaptics } from '../../hooks/useHaptics'

/**
 * ChipPicker — multi/single chip selector with built-in options + per-user
 * custom extras. Custom extras are persisted by the caller via the
 * `vault_options` table; this component only emits an `onExtraAdded(category,
 * value)` callback when the user commits a new tag.
 *
 * PRD-001 P0.7: custom tags are owned by the parent (Vault), which reads/
 * writes them via the vault_options Supabase table. The picker holds only
 * its own local-echo copy of `extras` so a newly-typed tag appears
 * immediately, before the round-trip to the DB completes.
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). Behavior is
 * bit-identical to the pre-split version.
 */
export default function ChipPicker({
  options,
  value,
  onChange,
  multi = true,
  category = null,
  extras = [],
  onExtraAdded = null,
}) {
  const [showAdd, setShowAdd]   = useState(false)
  const [draft, setDraft]       = useState('')
  const [localExtras, setLocalExtras] = useState(() => extras)
  const { trigger } = useHaptics()

  // Parent's grouped map is the source of truth — mirror updates here so
  // adding the same tag in two pickers (or re-fetching from the DB) keeps
  // every picker in sync.
  useEffect(() => { setLocalExtras(extras) }, [extras])

  const allOptions = [...options, ...localExtras.filter(e => !options.includes(e))]

  const isActive = (opt) => multi ? (value || []).includes(opt) : value === opt

  const toggle = (opt) => {
    trigger('selection')
    if (multi) {
      const cur = value || []
      onChange(cur.includes(opt) ? cur.filter(v => v !== opt) : [...cur, opt])
    } else {
      onChange(isActive(opt) ? null : opt)
    }
  }

  const commitCustom = () => {
    const tag = draft.trim()
    if (!tag) { setShowAdd(false); return }
    const next = [...new Set([...localExtras, tag])]
    setLocalExtras(next)              // optimistic local echo
    if (category && onExtraAdded) {
      onExtraAdded(category, tag)     // parent updates extrasByCategory and persists
    }
    // Auto-select the new tag
    if (multi) onChange([...(value || []).filter(v => v !== tag), tag])
    else onChange(tag)
    setDraft('')
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {allOptions.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
            isActive(opt)
              ? 'bg-brand-500 text-white border-brand-500'
              : 'bg-white text-gray-500 border-cream-200 hover:border-brand-300 hover:text-brand-600'
          }`}
        >
          {opt}
        </button>
      ))}

      {showAdd ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitCustom() }
              if (e.key === 'Escape') { setShowAdd(false); setDraft('') }
            }}
            placeholder="Type & press Enter"
            className="w-32 px-2.5 py-1 text-xs border border-brand-300 rounded-full outline-none focus:ring-1 focus:ring-brand-400 bg-white"
          />
          <button
            type="button"
            onClick={() => { setShowAdd(false); setDraft('') }}
            aria-label="Cancel custom tag"
            className="text-gray-300 hover:text-gray-500 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { trigger('light'); setShowAdd(true) }}
          className="px-2.5 py-1 rounded-full text-xs text-gray-400 border border-dashed border-gray-200 hover:border-brand-300 hover:text-brand-500 transition-all"
        >
          + custom
        </button>
      )}
    </div>
  )
}
