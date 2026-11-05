import { Camera, Loader2, Check } from 'lucide-react'
import { formatAmount } from '../../lib/groceryRecipes'

/** "olive oil — 2 tbsp", "garlic — 3, minced", "salt". */
function line(i) {
  const tail = [formatAmount(i.quantity, i.unit), typeof i.notes === 'string' ? i.notes.trim() : '']
    .filter(Boolean).join(', ')
  return tail ? `${i.name} — ${tail}` : i.name
}

const SOURCE_TEXT = {
  screenshot: 'Amounts from your screenshots',
  estimated: 'Amounts estimated by AI — add screenshots for the real ones',
}

/**
 * Where a recipe's amounts come from, and the screenshot button. The card
 * keeps ONE ingredient list (the essential / optional chips above this);
 * the amounts are saved for the grocery list but only shown right after a
 * read, in a "Here's what I read" panel she dismisses (Matt, 2026-11-05).
 *
 * @param {{
 *   recipe: object,
 *   status: null | { kind: 'reading' | 'error' | 'done', message?: string, list?: object[] },
 *   onReadScreenshots: (files: FileList) => void,
 *   onDismiss: () => void,
 * }} props
 */
export default function RecipeIngredients({ recipe, status, onReadScreenshots, onDismiss }) {
  const hasList = Array.isArray(recipe.ingredients_structured) && recipe.ingredients_structured.length > 0
  const reading = status?.kind === 'reading'
  const justRead = status?.kind === 'done' && Array.isArray(status.list) ? status.list : null
  const sourceText = !hasList
    ? 'No ingredients yet — the grocery list can’t include this recipe.'
    : (SOURCE_TEXT[recipe.ingredients_source] ?? null)

  return (
    <section aria-label="Ingredient amounts" className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {justRead && (
        <div role="status" aria-label="Here’s what I read"
          className="rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50 p-4 space-y-2">
          <p className="font-semibold text-gray-900">Here’s what I read ({justRead.length})</p>
          <ul className="text-sm text-gray-900 space-y-1">
            {justRead.map((i, n) => <li key={`${i.name}-${n}`}>{line(i)}</li>)}
          </ul>
          <p className="helper-text">Saved for your grocery list. This preview closes when you tap below.</p>
          <button type="button" onClick={onDismiss} className="btn-primary py-3 flex items-center justify-center gap-2">
            <Check size={18} aria-hidden="true" /> Looks right
          </button>
        </div>
      )}

      {!justRead && (sourceText || recipe.servings) && (
        <p className={`text-sm ${hasList ? 'helper-text' : 'text-amber-800 font-medium'}`} data-testid="ingredient-source">
          {[sourceText, hasList && recipe.servings ? `Serves ${recipe.servings}` : null].filter(Boolean).join(' · ')}
        </p>
      )}

      <label className={`btn-secondary py-3 flex items-center justify-center gap-2 cursor-pointer ${reading ? 'opacity-60 pointer-events-none' : ''}`}>
        {reading ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
        {reading ? 'Reading screenshots…' : 'Read ingredients from screenshots'}
        <input
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label={`Screenshots of the ${recipe.name} recipe (up to 3)`}
          disabled={reading}
          onChange={(e) => {
            const files = e.target.files
            if (files?.length) onReadScreenshots(files)
            e.target.value = ''
          }}
        />
      </label>
      {status?.kind === 'error' && <p role="alert" className="text-sm text-red-800">{status.message}</p>}
    </section>
  )
}
