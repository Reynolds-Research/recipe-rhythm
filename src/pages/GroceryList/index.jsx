import { useState, useEffect } from 'react'
import { Loader2, ShoppingCart, X } from 'lucide-react'
import Logo from '../../components/Logo'
import { supabase } from '../../lib/supabase'
import { fetchMostRecentPlan } from '../../lib/mealPlanReader'
import { getPreferences } from '../../lib/preferences'
import { GROCERY_SECTIONS } from '../../lib/constants'

export default function GroceryList({ userId }) {
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState(null)
  const [activePlan, setActivePlan] = useState(null)
  const [items, setItems]           = useState([])

  // Quiet re-fetch of the list + items without touching the page loading state.
  // Called at the end of handleGenerate after writes are complete.
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
      return
    }

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
        .select('name, vault_id, vault(name, servings, ingredients_classified, proteins, main_carb, vegetables, dairy_components, fruits)')
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

      // 2. Build recipes array.
      //    Primary source: ingredients_classified (AI-analysed essentiality list).
      //    Fallback: categorical fields (proteins, vegetables, etc.) for recipes
      //    that haven't been through the classify-ingredients pass yet.
      const skippedNoVault = []
      const recipes = []
      for (const item of planItems ?? []) {
        if (!item.vault) {
          skippedNoVault.push(item.name)
          continue
        }
        const v = item.vault
        const classified = v.ingredients_classified
        let ingredients
        if (Array.isArray(classified) && classified.length > 0) {
          ingredients = classified.map(c => c.name).filter(Boolean)
        } else {
          ingredients = [
            ...(v.proteins        || []),
            ...(v.main_carb       || []),
            ...(v.vegetables      || []),
            ...(v.dairy_components || []),
            ...(v.fruits          || []),
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
        body: JSON.stringify({ recipes, pantryStaples: [], householdSize: safeHouseholdSize }),
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

  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">

      {/* Header — matches Vault / BrainstormMode centered-header pattern */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">Grocery List</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* Inline error banner */}
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

        {/* No active plan */}
        {!activePlan && (
          <div className="text-center py-16 space-y-2">
            <ShoppingCart size={32} className="mx-auto text-gray-500" />
            <p className="body-text">No active planning period.</p>
            <p className="helper-text">Start one in Brainstorm to create a grocery list.</p>
          </div>
        )}

        {/* Active plan, no list yet, not generating */}
        {activePlan && !generating && items.length === 0 && (
          <div className="text-center py-16 space-y-4">
            <ShoppingCart size={32} className="mx-auto text-gray-500" />
            <p className="body-text">No grocery list yet for this plan.</p>
            <button onClick={handleGenerate} className="btn-primary">
              Generate List
            </button>
          </div>
        )}

        {/* Active plan, no list yet, generating */}
        {activePlan && generating && items.length === 0 && (
          <div className="text-center py-16 space-y-3">
            <Loader2 size={32} className="animate-spin mx-auto text-brand-500" />
            <p className="helper-text">Generating…</p>
          </div>
        )}

        {/* List with items */}
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

          </div>
        )}

      </div>
    </div>
  )
}
