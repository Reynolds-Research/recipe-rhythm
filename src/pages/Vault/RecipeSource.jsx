import { useState } from 'react'
import { ExternalLink, Link as LinkIcon, Loader2, ScanText } from 'lucide-react'
import { formatAmount } from '../../lib/groceryRecipes'
import { cleanLink } from './recipeSourceHelpers'

/** "olive oil — 2 tbsp", "garlic — 3, minced", "salt". */
function line(i) {
  const tail = [formatAmount(i.quantity, i.unit), typeof i.notes === 'string' ? i.notes.trim() : '']
    .filter(Boolean).join(', ')
  return tail ? `${i.name} — ${tail}` : i.name
}

/** "cooking.nytimes.com/…" style label for a saved link. */
const shortLink = (url) => url.replace(/^https?:\/\/(www\.)?/, '')

const ACTION = 'inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-brand-600 hover:text-brand-700 cursor-pointer'
const QUIET = 'min-h-[44px] text-sm font-semibold text-gray-700 hover:text-gray-900 underline'

/**
 * "Recipe source": where a recipe comes from — its link and/or screenshots of
 * its ingredients — side by side, editable without opening Edit (Matt,
 * 2026-11-05, mockup "Recipe Source Mockup"). Used on a Cookbook card and in
 * Add a recipe. Small text actions in the app's style; never the hero.
 *
 * @param {{
 *   name: string,                       recipe name (for labels)
 *   link: string|null,
 *   onSaveLink: (url: string|null) => void,
 *   source: 'screenshot'|'page'|'estimated'|null,
 *   servings: number|null,
 *   hasList: boolean,                   ingredient amounts saved
 *   hasNames: boolean,                  ingredient names (chips) exist
 *   reading?: boolean, error?: string|null,
 *   justRead?: object[]|null,           the list just read: shown until "Looks right"
 *   onDismissRead?: () => void,
 *   onScreenshots: (files: FileList) => void,
 *   onReadLink?: () => void,            "Read amounts from the link" (a saved link, list not real yet)
 *   readingWhat?: 'screenshots'|'page', what `reading` is reading
 *   showStatus?: boolean,               false in Add a recipe (nothing saved yet to describe)
 *   readSummary?: string,               form only: e.g. "✓ 11 ingredients read from 2 screenshots"
 * }} props
 */
export default function RecipeSource({
  name, link, onSaveLink, source, servings, hasList, hasNames,
  reading = false, error = null, justRead = null, onDismissRead, onScreenshots, readSummary = null, showStatus = true,
  onReadLink, readingWhat = 'screenshots',
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startLink = () => { setDraft(link ?? ''); setEditing(true) }
  const saveLink = () => { onSaveLink(cleanLink(draft)); setEditing(false) }

  const fromShots = source === 'screenshot' && hasList
  const fromPage = source === 'page' && hasList
  const serves = servings ? ` · Serves ${servings}` : ''
  const status = fromShots ? null
    : fromPage ? `Amounts from the recipe page${serves}`
      : hasList ? `Amounts estimated${serves}`
        : hasNames ? 'No amounts saved yet.' : 'No ingredients yet.'
  // A saved link whose amounts aren't the real recipe yet: offer to read it.
  const canReadLink = Boolean(onReadLink && link && !fromShots && !fromPage && !reading && !editing)

  const screenshotInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      className="sr-only"
      aria-label={`Screenshots of the ${name || 'recipe'} recipe's ingredients (up to 3)`}
      disabled={reading}
      onChange={(e) => {
        const files = e.target.files
        if (files?.length) onScreenshots(files)
        e.target.value = ''
      }}
    />
  )

  const addLinkButton = (
    <button type="button" onClick={startLink} className={ACTION}>
      <LinkIcon size={14} aria-hidden="true" /> Add link
    </button>
  )

  const screenshotAction = reading ? (
    <span role="status" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-gray-700">
      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
      {readingWhat === 'page' ? 'Reading the recipe page…' : 'Reading screenshots…'}
    </span>
  ) : fromShots && justRead ? null : fromShots ? (
    <div className="flex items-center gap-2 min-h-[44px]">
      <ScanText size={14} className="text-brand-600 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-sm text-gray-900">
        {readSummary ?? 'Amounts from your screenshots'}{serves}
      </span>
      <label className={`${QUIET} inline-flex items-center cursor-pointer`}>Replace{screenshotInput}</label>
    </div>
  ) : (
    <label className={ACTION}>
      <ScanText size={14} aria-hidden="true" /> Add screenshots{screenshotInput}
    </label>
  )

  return (
    <section aria-label="Recipe source" className="space-y-0.5" onClick={(e) => e.stopPropagation()}>
      <p className="section-heading">Recipe source</p>

      {editing ? (
        <div className="flex items-center gap-3">
          <input
            type="url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveLink() } }}
            placeholder="Paste the recipe's link"
            aria-label="Recipe link"
            autoFocus
            className="input-base flex-1 min-w-0"
          />
          <button type="button" onClick={saveLink} className="min-h-[44px] text-sm font-semibold text-brand-600">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] text-sm font-semibold text-gray-700">Cancel</button>
        </div>
      ) : link ? (
        <div className="flex items-center gap-2 min-h-[44px]">
          <ExternalLink size={14} className="text-brand-600 shrink-0" aria-hidden="true" />
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="flex-1 min-w-0 truncate text-sm font-medium text-brand-600 hover:text-brand-700">
            {shortLink(link)}
          </a>
          <button type="button" onClick={startLink} className={QUIET}>Change</button>
        </div>
      ) : null}

      {canReadLink && (
        <button type="button" onClick={onReadLink} className={ACTION}>
          <LinkIcon size={14} aria-hidden="true" /> Read amounts from the link
        </button>
      )}

      {!link && !editing && !fromShots && !reading
        ? <div className="flex flex-wrap gap-x-5">{addLinkButton}{screenshotAction}</div>
        : <>{!link && !editing && addLinkButton}{screenshotAction}</>}

      {justRead && (
        <div role="status" aria-label="Here’s what I read" className="mt-2 bg-cream-50 rounded-xl border border-cream-100 p-3 space-y-2">
          <p className="text-sm font-semibold text-gray-900">Here’s what I read{serves}</p>
          <ul className="text-sm text-gray-900 space-y-0.5 list-disc pl-5">
            {justRead.map((i, n) => <li key={`${i.name}-${n}`}>{line(i)}</li>)}
          </ul>
          <div className="flex items-center justify-between">
            <span className="helper-text">Saved for your grocery list.</span>
            <button type="button" onClick={onDismissRead} className="min-h-[44px] text-sm font-semibold text-brand-600">Looks right</button>
          </div>
        </div>
      )}

      {showStatus && !justRead && status && (
        <p data-testid="ingredient-source" className={`text-sm ${hasList ? 'text-gray-700' : 'text-amber-800'}`}>{status}</p>
      )}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </section>
  )
}
