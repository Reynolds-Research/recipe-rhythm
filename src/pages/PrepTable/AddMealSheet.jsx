import { useState } from 'react'
import { Sheet } from 'react-modal-sheet'
import { X, Plus, Bookmark } from 'lucide-react'
import RecipeSearchInput from '../../components/RecipeSearchInput'
import { searchRecipes } from '../../lib/recipeSearch'
import { dateLabel } from './labels'

/**
 * "+ add" — pick what goes on a day (or on the Maybe list).
 *
 * Search her cookbook (searchRecipes, the same search as the Cookbook page and
 * the old day picker). No match? "Add '<text>' as-is" saves a one-off meal,
 * not a cookbook recipe. For a day, her Maybe list is offered first: picking
 * one moves it onto the day instead of copying it.
 *
 * @param {{
 *   target: string | 'maybe' | null,   // a date, 'maybe', or null when closed
 *   vault: object[], maybe: object[],
 *   onPickRecipe: (recipe) => void, onAddAsIs: (name) => void, onPickMaybe: (meal) => void,
 *   onClose: () => void,
 * }} props
 */
export default function AddMealSheet({ target, vault = [], maybe = [], onPickRecipe, onAddAsIs, onPickMaybe, onClose }) {
  const [query, setQuery] = useState('')
  const isOpen = target != null
  const trimmed = query.trim()
  const results = trimmed ? searchRecipes(vault, trimmed).slice(0, 12) : []
  const title = target === 'maybe' ? 'Add to Maybe' : target ? `${dateLabel(target).weekday} ${dateLabel(target).monthDay}` : ''

  const close = () => { setQuery(''); onClose() }
  const pick = (fn) => (arg) => { setQuery(''); fn(arg) }

  return (
    <Sheet isOpen={isOpen} onClose={close} snapPoints={[0, 0.7, 0.95, 1]} initialSnap={1}>
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 py-2 pb-safe space-y-4" data-testid="add-meal-sheet">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-heading text-brand-700">Add a meal</p>
                <p className="text-lg font-semibold text-gray-900">{title}</p>
              </div>
              <button type="button" onClick={close} aria-label="Close" className="btn-icon"><X size={18} /></button>
            </div>

            <RecipeSearchInput value={query} onChange={setQuery} placeholder="Search your cookbook" />

            {trimmed && (
              <ul className="space-y-2" aria-label="From your cookbook">
                {results.map((recipe) => (
                  <li key={recipe.id}>
                    <button type="button" onClick={() => pick(onPickRecipe)(recipe)}
                      className="w-full text-left card p-3 min-h-[48px] font-medium text-gray-900 hover:border-brand-200">
                      {recipe.name}
                      {recipe.cuisine_type && <span className="block text-xs text-gray-700">{recipe.cuisine_type}</span>}
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => pick(onAddAsIs)(trimmed)}
                    className="w-full text-left rounded-2xl border-2 border-dashed border-cream-200 p-3 min-h-[48px] font-semibold text-brand-700 flex items-center gap-2">
                    <Plus size={16} /> Add “{trimmed}” as-is
                  </button>
                </li>
              </ul>
            )}

            {!trimmed && target !== 'maybe' && maybe.length > 0 && (
              <div className="space-y-2">
                <p className="section-heading">From your Maybe list</p>
                <ul className="space-y-2">
                  {maybe.map((meal) => (
                    <li key={meal.id}>
                      <button type="button" onClick={() => pick(onPickMaybe)(meal)}
                        className="w-full text-left card p-3 min-h-[48px] font-medium text-gray-900 flex items-center gap-2">
                        <Bookmark size={16} className="text-brand-700" aria-hidden="true" /> {meal.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!trimmed && (target === 'maybe' || maybe.length === 0) && (
              <p className="helper-text">Type a recipe name, a cuisine or an ingredient.</p>
            )}
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={close} />
    </Sheet>
  )
}
