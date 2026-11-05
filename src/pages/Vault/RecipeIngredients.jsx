import { Camera, Loader2 } from 'lucide-react'

/** "olive oil — 2 tbsp", "garlic — 3, minced", "salt". */
function line(i) {
  const amount = [i.quantity, i.unit].filter((x) => typeof x === 'string' && x.trim()).join(' ')
  const tail = [amount, typeof i.notes === 'string' ? i.notes.trim() : ''].filter(Boolean).join(', ')
  return tail ? `${i.name} — ${tail}` : i.name
}

const SOURCE_TEXT = {
  screenshot: 'From your screenshots',
  estimated: 'Estimated by AI — add screenshots for the real amounts',
}

/**
 * A recipe's ingredient list on its Cookbook card: what the grocery list will
 * use, where it came from, and a way to replace it with the real recipe from
 * up to 3 screenshots.
 *
 * @param {{
 *   recipe: object,
 *   status: null | { kind: 'reading' | 'error' | 'done', message?: string },
 *   onReadScreenshots: (files: FileList) => void,
 * }} props
 */
export default function RecipeIngredients({ recipe, status, onReadScreenshots }) {
  const list = Array.isArray(recipe.ingredients_structured) ? recipe.ingredients_structured : []
  const reading = status?.kind === 'reading'
  const sourceText = list.length === 0
    ? 'No ingredients yet — the grocery list can’t include this recipe.'
    : (SOURCE_TEXT[recipe.ingredients_source] ?? null)

  return (
    <section aria-label="Ingredient list" className="space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="section-heading">Ingredient list</p>
        {recipe.servings && <span className="helper-text">Serves {recipe.servings}</span>}
      </div>
      {sourceText && (
        <p className={`text-sm ${list.length === 0 ? 'text-amber-800 font-medium' : 'helper-text'}`} data-testid="ingredient-source">
          {sourceText}
        </p>
      )}
      {list.length > 0 && (
        <ul className="text-sm text-gray-900 space-y-1">
          {list.map((i, n) => <li key={`${i.name}-${n}`}>{line(i)}</li>)}
        </ul>
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
      {status?.kind === 'done' && <p role="status" className="text-sm text-gray-900">{status.message}</p>}
    </section>
  )
}
