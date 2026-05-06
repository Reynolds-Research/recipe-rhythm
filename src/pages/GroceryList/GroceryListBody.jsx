import { useState, useEffect } from 'react'
import { Loader2, ShoppingCart, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fetchMostRecentPlan } from '../../lib/mealPlanReader'
import { getPreferences } from '../../lib/preferences'
import { GROCERY_SECTIONS } from '../../lib/constants'

/**
 * PRD-006 Bite δ: format a single structured-ingredient entry as a string
 * the grocery-list AI can read. The model gets quantity + unit inline so
 * it scales the actual recipe quantity instead of re-estimating from the
 * name. Examples:
 *   { name: 'olive oil', quantity: '2', unit: 'tbsp' }       → "olive oil: 2 tbsp"
 *   { name: 'garlic clove', quantity: '3', unit: null,
 *     notes: 'minced' }                                       → "garlic clove: 3, minced"
 *   { name: 'kosher salt', quantity: null, unit: null,
 *     notes: 'to taste' }                                     → "kosher salt: to taste"
 *   { name: 'olive oil' }                                     → "olive oil"
 *
 * Returns null when the entry has no usable name.
 */
function formatStructuredIngredient(entry) {
  if (!entry || typeof entry.name !== 'string') return null
  const name = entry.name.trim()
  if (!name) return null

  const qty = typeof entry.quantity === 'string' ? entry.quantity.trim() : ''
  const unit = typeof entry.unit === 'string' ? entry.unit.trim() : ''
  const notes = typeof entry.notes === 'string' ? entry.notes.trim() : ''

  const measureParts = [qty, unit].filter(Boolean).join(' ').trim()
  const tail = [measureParts, notes].filter(Boolean).join(', ')

  return tail ? `${name}: ${tail}` : name
}

export default function GroceryListBody({ userId }) {
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState(null)
  const [activePlan, setActivePlan] = useState(null)
  const [items, setItems]           = useState([])
  const [listId, setListId]         = useState(null)
  const [adhocDraft, setAdhocDraft] = useState('')
  const [addingAdhoc, setAddingAdhoc] = useState(false)

  async function loadList(planId) {
    const { data: listRow, error: listErr } = await supabase
      .from('grocery_lists')
      .select('id, created_at')
      .eq('user_id', userId)
      .eq('meal_plan_id', planId)
      .maybeSingle()
    if (listErr) throw listErr

    if (!listRow) {
      setItems([])
      setListId(null)
      return
    }

    setListId(listRow.id)

    const { data: itemRows, error: itemErr } = await supabase
      .from('grocery_list_items')
      .select('id, name, quantity, section')
      .eq('list_id', listRow.id)
      .order('created_at', { ascending: true })
    if (itemErr) throw itemErr
    setItems(itemRows ?? [])
  }

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const { plan } = await fetchMostRecentPlan(supabase, userId)
        setActivePlan(plan ?? null)
        if (plan) await loadList(plan.id)
      } catch (err) {
        console.error('[GroceryList] loadData:', err)
        setError('Could not load grocery list. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  async function handleGenerate() {
    if (generating || !activePlan) return
    setGenerating(true)
    setError(null)

    try {
      // 1. Fetch plan items joined to vault for name + ingredients.
      //    Select categorical fields too so we can fall back when
      //    ingredients_classified hasn't been populated yet.
      const { data: planItems, error: piErr } = await supabase
        .from('meal_plan_items')
        .select('name, vault_id, vault(name, servings, ingredients_structured, ingredients_classified, proteins, main_carb, vegetables, dairy_components, fruits)')
        .eq('meal_plan_id', activePlan.id)
        .eq('is_shortlisted', false)
        .not('vault_id', 'is', null)
      if (piErr) throw piErr

      // PRD-006 Bite γ: household size drives quantity scaling. getPreferences
      // returns the row defaults (adults=2, children=0) when the user has never
      // opened Settings — see src/lib/preferences.js.
      const prefs = await getPreferences(userId, supabase)
      const householdSize = (prefs?.adults ?? 2) + (prefs?.children ?? 0)
      const safeHouseholdSize = Math.max(1, householdSize)
      const pantryStaples = Array.isArray(prefs?.pantry_staples) ? prefs.pantry_staples : []

      // 2. Build recipes array.
      //    Preference order:
      //      1. ingredients_structured — names + quantities + units + notes (Bite δ)
      //      2. ingredients_classified — names only (PRD-004 Phase A backfill)
      //      3. chip arrays            — fallback for the oldest rows
      const skippedNoVault = []
      const recipes = []
      for (const item of planItems ?? []) {
        if (!item.vault) {
          skippedNoVault.push(item.name)
          continue
        }
        const v = item.vault

        let ingredients = null
        const structured = v.ingredients_structured
        if (Array.isArray(structured) && structured.length > 0) {
          ingredients = structured
            .map(formatStructuredIngredient)
            .filter(Boolean)
        }
        if (!ingredients || ingredients.length === 0) {
          const classified = v.ingredients_classified
          if (Array.isArray(classified) && classified.length > 0) {
            ingredients = classified.map(c => c?.name).filter(Boolean)
          }
        }
        if (!ingredients || ingredients.length === 0) {
          ingredients = [
            ...(v.proteins         || []),
            ...(typeof v.main_carb === 'string' && v.main_carb ? [v.main_carb] : []),
            ...(v.vegetables       || []),
            ...(v.dairy_components || []),
            ...(v.fruits           || []),
          ].filter(Boolean)
        }
        if (ingredients.length === 0) {
          console.warn('[GroceryList] no ingredient data for vault recipe:', v.name)
          continue
        }
        recipes.push({ name: v.name, ingredients, servings: v.servings ?? null })
      }
      if (skippedNoVault.length) {
        console.warn('[GroceryList] skipped (no vault row):', skippedNoVault)
      }

      if (recipes.length === 0) {
        setError('None of the meals in this plan have ingredient data. Open each recipe in your Cookbook and save it to trigger ingredient analysis.')
        return
      }

      // 3. Call /api/grocery-list
      const res = await fetch('/api/grocery-list', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipes, pantryStaples, householdSize: safeHouseholdSize }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        console.error('[GroceryList] API error:', res.status, body)
        setError('Could not generate grocery list. Please try again.')
        return
      }
      const { items: apiItems } = await res.json()

      // 4. Upsert grocery_lists row
      let listId
      const { data: existing } = await supabase
        .from('grocery_lists')
        .select('id')
        .eq('user_id', userId)
        .eq('meal_plan_id', activePlan.id)
        .maybeSingle()

      if (existing) {
        listId = existing.id
      } else {
        const { data: newList, error: insertErr } = await supabase
          .from('grocery_lists')
          .insert({ user_id: userId, meal_plan_id: activePlan.id })
          .select('id')
          .single()
        if (insertErr) throw insertErr
        listId = newList.id
      }

      // 5. Overwrite items (Bite C-1: preserve-checkmarks is Bite C-2)
      await supabase.from('grocery_list_items').delete().eq('list_id', listId)

      if (apiItems?.length > 0) {
        const { error: insertItemsErr } = await supabase
          .from('grocery_list_items')
          .insert(
            apiItems.map(item => ({
              list_id:   listId,
              name:      item.name,
              quantity:  item.quantity ?? null,
              section:   item.section  ?? 'Other',
              is_bought: false,
              is_adhoc:  false,
            }))
          )
        if (insertItemsErr) throw insertItemsErr
      }

      // 6. Re-fetch from DB — never trust optimistic state from the API response
      await loadList(activePlan.id)
    } catch (err) {
      console.error('[GroceryList] handleGenerate:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleAddAdhoc() {
    const name = adhocDraft.trim()
    if (!name) return
    if (!listId) {
      setError('Generate a list first, then add custom items.')
      return
    }
    if (addingAdhoc) return

    setAddingAdhoc(true)
    setError(null)

    try {
      const { error: insertErr } = await supabase
        .from('grocery_list_items')
        .insert({
          list_id:   listId,
          name,
          quantity:  null,
          section:   'Other',
          is_bought: false,
          is_adhoc:  true,
        })
      if (insertErr) throw insertErr

      setAdhocDraft('')
      await loadList(activePlan.id)
    } catch (err) {
      console.error('[GroceryList] handleAddAdhoc:', err)
      setError('Could not add item. Please try again.')
    } finally {
      setAddingAdhoc(false)
    }
  }

  function onAdhocKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAddAdhoc()
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    )
  }

  return (
    <>
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-xl border border-red-100 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            className="text-red-400 hover:text-red-600 ml-3 shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {!activePlan && (
        <div className="text-center py-16 space-y-2">
          <ShoppingCart size={32} className="mx-auto text-gray-500" />
          <p className="body-text">No active planning period.</p>
          <p className="helper-text">Start one in Brainstorm to create a grocery list.</p>
        </div>
      )}

      {activePlan && !generating && items.length === 0 && (
        <div className="text-center py-16 space-y-4">
          <ShoppingCart size={32} className="mx-auto text-gray-500" />
          <p className="body-text">No grocery list yet for this plan.</p>
          <button onClick={handleGenerate} className="btn-primary">
            Generate List
          </button>
        </div>
      )}

      {activePlan && generating && items.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <Loader2 size={32} className="animate-spin mx-auto text-brand-500" />
          <p className="helper-text">Generating…</p>
        </div>
      )}

      {items.length > 0 && (
        <div className="space-y-5">

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="btn-secondary"
          >
            {generating
              ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Generating…
                </span>
              )
              : 'Regenerate'
            }
          </button>

          {GROCERY_SECTIONS.map(section => {
            const sectionItems = items.filter(i => i.section === section)
            if (sectionItems.length === 0) return null
            return (
              <section key={section}>
                <div className="flex items-center gap-2 mb-2">
                  <p className="section-heading">{section}</p>
                  <div className="flex-1 h-px bg-cream-200" />
                </div>
                <ul className="space-y-2">
                  {sectionItems.map(item => (
                    <li
                      key={item.id}
                      className="flex items-baseline justify-between gap-3 py-1"
                    >
                      <span className="body-text">{item.name}</span>
                      {item.quantity && (
                        <span className="helper-text shrink-0">{item.quantity}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          <form
            onSubmit={(e) => { e.preventDefault(); handleAddAdhoc() }}
            className="flex gap-2 pt-2 border-t border-cream-200"
            aria-label="Add a custom grocery item"
          >
            <input
              type="text"
              value={adhocDraft}
              onChange={(e) => setAdhocDraft(e.target.value)}
              onKeyDown={onAdhocKeyDown}
              placeholder="Add an item…"
              aria-label="Custom grocery item"
              disabled={addingAdhoc}
              className="input-base flex-1"
            />
            <button
              type="submit"
              disabled={addingAdhoc || !adhocDraft.trim()}
              className="btn-primary w-auto shrink-0 px-5"
            >
              {addingAdhoc
                ? <Loader2 size={16} className="animate-spin" />
                : 'Add'
              }
            </button>
          </form>

        </div>
      )}
    </>
  )
}
