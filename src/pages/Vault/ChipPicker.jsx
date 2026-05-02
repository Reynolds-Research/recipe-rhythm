import { useState } from 'react'
import { X } from 'lucide-react'
import { useHaptics } from '../../hooks/useHaptics'

/**
 * ChipPicker — multi/single chip selector with built-in options + per-user
 * custom extras. Custom extras are persisted by the caller via the
 * `vault_options` table; this component only emits an `onExtraAdded(category,
 * value)` callback when the user commits a new tag.
 *
 * PRD-001 P0.7: custom tags are owned by the parent (Vault) and surfaced
 * here via the `extras` prop. The parent (`useVault.addExtra`) updates
 * `extrasByCategory` synchronously inside the same event tick, so the new
 * chip is already in `extras` by the next render — no local mirror needed.
 *
 * PRD-002 P0.2: also accepts an `items` prop with `{ id, label }` shape
 * (alongside the legacy `options: string[]` API). When `items` is supplied
 * the picker keys on `id` (selected value(s) are id strings) and renders
 * `label`. Custom extras are disabled in items-mode — the Preferences page
 * uses fixed app-vocabulary lists, not user-extensible categories.
 */
export default function ChipPicker({
  options,
  items,
  value,
  onChange,
  multi = true,
  category = null,
  extras = [],
  onExtraAdded = null,
  allowCustom = true,
  ariaLabel = null,
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft]     = useState('')
  const { trigger } = useHaptics()

  const itemsMode = Array.isArray(items)

  // Normalize to a list of { key, label } for rendering. In items-mode the
  // key is the item's id (what we store + emit). In options-mode the key
  // and label are the option string itself.
  const renderItems = itemsMode
    ? items.map(it => ({ key: it.id, label: it.label }))
    : [...(options || []), ...extras.filter(e => !(options || []).includes(e))]
        .map(opt => ({ key: opt, label: opt }))

  const isActive = (key) => multi ? (value || []).includes(key) : value === key

  const toggle = (key) => {
    trigger('selection')
    if (multi) {
      const cur = value || []
      onChange(cur.includes(key) ? cur.filter(v => v !== key) : [...cur, key])
    } else {
      onChange(isActive(key) ? null : key)
    }
  }

  const commitCustom = () => {
    const tag = draft.trim()
    if (!tag) { setShowAdd(false); return }
    if (category && onExtraAdded) {
      onExtraAdded(category, tag)     // parent updates extrasByCategory and persists
    }
    // Auto-select the new tag
    if (multi) onChange([...(value || []).filter(v => v !== tag), tag])
    else onChange(tag)
    setDraft('')
  }

  const showCustomEntry = allowCustom && !itemsMode

  return (
    <div
      className="flex flex-wrap gap-2 items-center"
      role="group"
      aria-label={ariaLabel || undefined}
    >
      {renderItems.map(({ key, label }) => {
        const active = isActive(key)
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={multi ? active : undefined}
            className={active ? 'chip chip-selected' : 'chip hover:border-brand-300 hover:text-brand-700'}
          >
            {label}
          </button>
        )
      })}

      {showCustomEntry && (showAdd ? (
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
            className="w-32 px-3 py-2 text-sm border border-brand-300 rounded-full outline-none focus:ring-1 focus:ring-brand-400 bg-white"
          />
          <button
            type="button"
            onClick={() => { setShowAdd(false); setDraft('') }}
            aria-label="Cancel custom tag"
            className="text-gray-700 hover:text-gray-900 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { trigger('light'); setShowAdd(true) }}
          className="chip border-dashed text-gray-700 hover:border-brand-300 hover:text-brand-700"
        >
          + custom
        </button>
      ))}
    </div>
  )
}
