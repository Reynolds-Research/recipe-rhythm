import { Trash2, ChevronDown, ChevronUp, ExternalLink, Star } from 'lucide-react'
import ChipPicker from './ChipPicker'
import {
  CUISINE_OPTIONS, FLAVOR_OPTIONS, PROTEIN_OPTIONS,
  COOKING_METHOD_OPTIONS, CARB_OPTIONS, DIETARY_OPTIONS,
  DAIRY_OPTIONS, VEGETABLE_OPTIONS, FRUIT_OPTIONS,
} from '../../lib/constants'

/**
 * RecipeCard — the per-recipe row in the vault list. Renders the collapsed
 * card (name + tag chips + family rating) and the expanded detail (component
 * rows + recipe link + image + edit/delete actions). When the card is in
 * edit mode, the inline edit JSX is rendered here as well.
 *
 * `ComponentRow` and `StarRating` move into this file as private helpers
 * since they're only used here. `FieldSection` is a small private helper
 * (duplicated in RecipeForm — both are 6 lines, splitting them across
 * components keeps each file independently readable).
 *
 * Extracted from Vault.jsx in PRD-001 P0.9 (Phase 3 Step 2). Behavior is
 * bit-identical to the pre-split version.
 */

function FieldSection({ label, children }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{label}</p>
      {children}
    </div>
  )
}

function ComponentRow({ label, values }) {
  if (!values || values.length === 0) return null
  const filtered = values.filter(v => v && v !== 'None')
  if (filtered.length === 0) return null
  return (
    <div className="flex gap-2 items-start">
      <span className="text-[11px] font-bold text-gray-300 uppercase tracking-wider pt-0.5 w-12 shrink-0">{label}</span>
      <div className="flex flex-wrap gap-1">
        {filtered.map(v => (
          <span key={v} className="px-2 py-0.5 bg-cream-100 text-gray-600 text-xs rounded-full">{v}</span>
        ))}
      </div>
    </div>
  )
}

/**
 * StarRating — PRD-001 P1.1 family rating widget.
 *
 * 1–5 tap-to-rate stars. `value` is `null` (unrated) or an integer 1..5.
 * Tapping an unfilled star sets the rating to that star's number; tapping
 * the currently-selected (rightmost-filled) star clears the rating back
 * to `null`. The component resolves the toggle and calls `onChange` with
 * the resulting value (number or null) — callers shouldn't have to know
 * about toggling.
 *
 * Stops click propagation so taps don't also toggle the parent recipe
 * card's expand/collapse handler.
 */
function StarRating({ value, onChange, size = 18, label = 'Family rating' }) {
  return (
    <div
      className="flex items-center gap-0.5"
      role="radiogroup"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
    >
      {[1, 2, 3, 4, 5].map(n => {
        const filled = value !== null && value !== undefined && n <= value
        return (
          <button
            key={n}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              // Toggle: re-tapping the currently-selected star clears to NULL.
              onChange(value === n ? null : n)
            }}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            aria-checked={value === n}
            role="radio"
            className={`p-0.5 rounded transition-colors ${
              filled ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'
            }`}
          >
            <Star
              size={size}
              strokeWidth={2}
              fill={filled ? 'currentColor' : 'none'}
            />
          </button>
        )
      })}
    </div>
  )
}

export default function RecipeCard({
  recipe,
  expanded,
  editing,
  editFields,
  setEditFields,
  savingEdit,
  extrasByCategory,
  onAddExtra,
  onToggleExpand,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRatingChange,
}) {
  return (
    <div className="card group hover:border-brand-200 transition-colors">
      <div
        className="flex items-center gap-4 cursor-pointer"
        onClick={() => onToggleExpand(recipe.id)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium text-gray-900 truncate leading-tight group-hover:text-brand-600 transition-colors">
            {recipe.name}
          </p>
          <div className="flex flex-wrap items-center gap-x-1.5 mt-1">
            {[
              recipe.cuisine_type,
              recipe.cooking_method,
              ...(recipe.proteins || []).filter(p => p !== 'None').slice(0, 2),
            ].filter(Boolean).map((item, i) => (
              <span key={item} className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                {i > 0 && '· '}{item}
              </span>
            ))}
            {recipe.auto_completed && (
              <span className="text-[11px] font-bold text-amber-500/80 border border-amber-200 bg-amber-50 rounded-full px-1.5 py-0.5 uppercase tracking-wide leading-none">
                AI-filled
              </span>
            )}
            {recipe.prep_time_minutes != null && (
              <span className="text-[11px] text-gray-500 font-medium">
                · {recipe.prep_time_minutes} min
              </span>
            )}
          </div>
          {/* PRD-001 P1.1 — family rating, always visible at a glance */}
          <div className="mt-1.5">
            <StarRating
              value={recipe.family_rating ?? null}
              onChange={(newRating) => onRatingChange(recipe.id, newRating)}
              size={14}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 text-gray-300 group-hover:text-brand-400 transition-colors">
          {expanded
            ? <ChevronUp size={20} strokeWidth={2.5} />
            : <ChevronDown size={20} strokeWidth={2.5} />
          }
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-cream-100 space-y-3">
          {editing ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <select value={editFields.cuisine_type} onChange={e => setEditFields(f => ({ ...f, cuisine_type: e.target.value }))} className="input-base text-sm">
                  <option value="">Cuisine…</option>
                  {CUISINE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={editFields.flavor_profile} onChange={e => setEditFields(f => ({ ...f, flavor_profile: e.target.value }))} className="input-base text-sm">
                  <option value="">Flavor…</option>
                  {FLAVOR_OPTIONS.map(fl => <option key={fl} value={fl}>{fl}</option>)}
                </select>
              </div>
              {/* PRD-001 P1.1 — rating saves immediately (independent of "Save changes") */}
              <FieldSection label="Family rating">
                <StarRating
                  value={recipe.family_rating ?? null}
                  onChange={(newRating) => onRatingChange(recipe.id, newRating)}
                  size={22}
                />
              </FieldSection>
              <FieldSection label="Protein">
                <ChipPicker options={PROTEIN_OPTIONS} value={editFields.proteins} onChange={v => setEditFields(f => ({ ...f, proteins: v }))} multi category="proteins" extras={extrasByCategory.proteins || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Cooking method">
                <ChipPicker options={COOKING_METHOD_OPTIONS} value={editFields.cooking_method} onChange={v => setEditFields(f => ({ ...f, cooking_method: v }))} multi={false} category="cooking_method" extras={extrasByCategory.cooking_method || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Main carb">
                <ChipPicker options={CARB_OPTIONS} value={editFields.main_carb} onChange={v => setEditFields(f => ({ ...f, main_carb: v }))} multi={false} category="main_carb" extras={extrasByCategory.main_carb || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Dietary tags">
                <ChipPicker options={DIETARY_OPTIONS} value={editFields.dietary_tags} onChange={v => setEditFields(f => ({ ...f, dietary_tags: v }))} multi category="dietary_tags" extras={extrasByCategory.dietary_tags || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Dairy">
                <ChipPicker options={DAIRY_OPTIONS} value={editFields.dairy_components} onChange={v => setEditFields(f => ({ ...f, dairy_components: v }))} multi category="dairy_components" extras={extrasByCategory.dairy_components || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Vegetables">
                <ChipPicker options={VEGETABLE_OPTIONS} value={editFields.vegetables} onChange={v => setEditFields(f => ({ ...f, vegetables: v }))} multi category="vegetables" extras={extrasByCategory.vegetables || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <FieldSection label="Fruit">
                <ChipPicker options={FRUIT_OPTIONS} value={editFields.fruits} onChange={v => setEditFields(f => ({ ...f, fruits: v }))} multi category="fruits" extras={extrasByCategory.fruits || []} onExtraAdded={onAddExtra} />
              </FieldSection>
              <input
                type="text"
                value={editFields.notes}
                onChange={e => setEditFields(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notes (e.g. add more lime next time)"
                className="input-base"
              />
              <input
                type="url"
                value={editFields.recipe_url}
                onChange={e => setEditFields(f => ({ ...f, recipe_url: e.target.value }))}
                placeholder="Recipe URL (optional)"
                className="input-base"
              />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => onSaveEdit(recipe.id)}
                  disabled={savingEdit}
                  className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {savingEdit ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  onClick={onCancelEdit}
                  className="px-4 py-2 rounded-2xl border border-gray-200 text-sm text-gray-500"
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <ComponentRow label="Protein"  values={recipe.proteins} />
              <ComponentRow label="Carb"     values={recipe.main_carb ? [recipe.main_carb] : []} />
              <ComponentRow label="Method"   values={recipe.cooking_method ? [recipe.cooking_method] : []} />
              <ComponentRow label="Flavor"   values={recipe.flavor_profile ? [recipe.flavor_profile] : []} />
              <ComponentRow label="Diet"     values={recipe.dietary_tags} />
              <ComponentRow label="Dairy"    values={recipe.dairy_components} />
              <ComponentRow label="Veg"      values={recipe.vegetables} />
              <ComponentRow label="Fruit"    values={recipe.fruits} />

              {recipe.notes && (
                <div className="bg-cream-50 rounded-xl p-3 border border-cream-100">
                  <p className="text-xs text-gray-600 leading-relaxed font-serif italic">{recipe.notes}</p>
                </div>
              )}
              {recipe.recipe_url && (
                <a
                  href={recipe.recipe_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-brand-500 hover:text-brand-700 transition-colors truncate"
                >
                  <ExternalLink size={11} className="shrink-0" />
                  <span className="truncate">{recipe.recipe_url.replace(/^https?:\/\//, '')}</span>
                </a>
              )}

              {recipe.image_url && (
                <div className="mt-2 rounded-xl overflow-hidden border border-cream-200">
                  <img src={recipe.image_url} alt={recipe.name} className="w-full h-auto object-cover max-h-48" />
                </div>
              )}

              <div className="flex items-center gap-2 pt-2 border-t border-cream-100 mt-2">
                <button
                  onClick={() => onStartEdit(recipe)}
                  className="py-2 px-3 text-[11px] font-bold text-brand-600 bg-brand-50 rounded-lg uppercase tracking-widest hover:bg-brand-100 transition-colors flex-1 text-center"
                >
                  Edit components
                </button>
                <button
                  onClick={() => onDelete(recipe.id)}
                  className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[11px] font-bold text-red-600 bg-red-50 uppercase tracking-widest hover:bg-red-100 transition-colors flex-1"
                >
                  <Trash2 size={12} strokeWidth={2.5} />
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
