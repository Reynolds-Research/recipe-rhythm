import { useState, useEffect } from 'react'
import { Loader2, ShoppingCart, X } from 'lucide-react'
import { Sheet } from 'react-modal-sheet'
import { supabase } from '../../lib/supabase'
import { getHouseholdId } from '../../lib/household'
import { apiFetch } from '../../lib/apiClient'
import { fetchMostRecentPlan } from '../../lib/mealPlanReader'
import { getPreferences } from '../../lib/preferences'
import { GROCERY_SECTIONS } from '../../lib/constants'
import { GROCERY_VAULT_COLUMNS, groceryPrefs, recipesFromMeals } from '../../lib/groceryRecipes'

export default function GroceryListBody({ userId }) {
  const [loading, setLoading]       = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState(null)
  const [activePlan, setActivePlan] = useState(null)
  const [items, setItems]           = useState([])
  const [listId, setListId]               = useState(null)
  const [shareToken, setShareToken]       = useState(null)
  const [shareSheetOpen, setShareSheetOpen] = useState(false)
  const [shareBusy, setShareBusy]         = useState(false)
  const [adhocDraft, setAdhocDraft]       = useState('')
  const [addingAdhoc, setAddingAdhoc]     = useState(false)
  const [skippedMeals, setSkippedMeals]   = useState([])

  async function loadList(planId) {
    const householdId = await getHouseholdId(supabase, userId)
    const { data: listRow, error: listErr } = await supabase
      .from('grocery_lists')
      .select('id, created_at, share_token')
      .eq('household_id', householdId)
      .eq('meal_plan_id', planId)
      .maybeSingle()
    if (listErr) throw listErr

    if (!listRow) {
      setItems([])
      setListId(null)
      setShareToken(null)
      return
    }

    setListId(listRow.id)
    setShareToken(listRow.share_token ?? null)

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
    setSkippedMeals([])

    try {
      // 1. Fetch plan items joined to vault for name + ingredients.
      //    Select categorical fields too so we can fall back when
      //    ingredients_classified hasn't been populated yet.
      //    We intentionally do NOT filter vault_id IS NOT NULL here — AI-
      //    suggestion meals (vault_id = null) are caught in the loop below
      //    and surfaced to the user instead of silently dropped.
      const { data: planItems, error: piErr } = await supabase
        .from('meal_plan_items')
        .select(`name, vault_id, vault(${GROCERY_VAULT_COLUMNS})`)
        .eq('meal_plan_id', activePlan.id)
        .eq('is_shortlisted', false)
      if (piErr) throw piErr

      // PRD-006 Bite γ: household size drives quantity scaling. getPreferences
      // returns the row defaults (adults=2, children=0) when the user has never
      // opened Settings — see src/lib/preferences.js.
      const prefs = await getPreferences(userId, supabase)
      const { householdSize: safeHouseholdSize, pantryStaples } = groceryPrefs(prefs)

      // 2. Build recipes array (src/lib/groceryRecipes.js — shared with the
      //    new Prep Table's Confirm the week).
      const { recipes, notInCookbook: skippedNoVault, noIngredients } = recipesFromMeals(planItems)
      for (const name of noIngredients) {
        console.warn('[GroceryList] no ingredient data for vault recipe:', name)
      }
      if (skippedNoVault.length) {
        console.warn('[GroceryList] skipped (no vault row):', skippedNoVault)
        setSkippedMeals(skippedNoVault)
      }

      if (recipes.length === 0) {
        if (skippedNoVault.length > 0) {
          setError(
            `None of the meals in this plan are in your Cookbook. Add them to your Cookbook first, then regenerate the list. Skipped: ${skippedNoVault.join(', ')}.`
          )
        } else {
          setError('None of the meals in this plan have ingredient data. Open each recipe in your Cookbook and save it to trigger ingredient analysis.')
        }
        return
      }

      // 3. Call /api/grocery-list
      const res = await apiFetch('/api/grocery-list', {
        method: 'POST',
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
      // One list per plan per household (PRD-008): either partner's
      // regenerate refreshes the same list.
      let listId
      const householdId = await getHouseholdId(supabase, userId)
      const { data: existing } = await supabase
        .from('grocery_lists')
        .select('id')
        .eq('household_id', householdId)
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

  const shareUrl = shareToken
    ? `${window.location.origin}/share/grocery/${shareToken}`
    : null

  async function handleGenerateShareLink() {
    if (!listId || shareBusy) return
    setShareBusy(true)
    setError(null)
    try {
      const newToken = crypto.randomUUID()
      const { error: updErr } = await supabase
        .from('grocery_lists')
        .update({ share_token: newToken })
        .eq('id', listId)
      if (updErr) throw updErr
      setShareToken(newToken)
    } catch (err) {
      console.error('[GroceryList] handleGenerateShareLink:', err)
      setError('Could not create share link. Please try again.')
    } finally {
      setShareBusy(false)
    }
  }

  async function handleRevokeShareLink() {
    if (!listId || shareBusy) return
    setShareBusy(true)
    setError(null)
    try {
      const { error: updErr } = await supabase
        .from('grocery_lists')
        .update({ share_token: null })
        .eq('id', listId)
      if (updErr) throw updErr
      setShareToken(null)
    } catch (err) {
      console.error('[GroceryList] handleRevokeShareLink:', err)
      setError('Could not revoke share link. Please try again.')
    } finally {
      setShareBusy(false)
    }
  }

  async function handleCopyLink() {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      // Some browsers (older Safari, embedded webviews) reject clipboard
      // writes outside a user-initiated context. The URL is visible in the
      // read-only input — the user can long-press to copy manually.
      console.warn('[GroceryList] clipboard write blocked')
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

      {skippedMeals.length > 0 && (
        <div className="mb-4 px-4 py-3 bg-amber-50 text-amber-800 text-sm rounded-xl border border-amber-200 flex items-start justify-between gap-2">
          <span>
            <strong>Not in your Cookbook:</strong>{' '}
            {skippedMeals.join(', ')}. Add these to your Cookbook to include their ingredients in the list.
          </span>
          <button
            onClick={() => setSkippedMeals([])}
            aria-label="Dismiss warning"
            className="text-amber-500 hover:text-amber-700 shrink-0 mt-0.5"
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

          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="btn-secondary flex-1"
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
            <button
              onClick={() => setShareSheetOpen(true)}
              className="btn-primary flex-1"
            >
              {shareToken ? 'Share link active' : 'Share with…'}
            </button>
          </div>

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

      <Sheet
        isOpen={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        detent="content-height"
      >
        <Sheet.Container>
          <Sheet.Header />
          <Sheet.Content>
            <div className="px-5 pb-8 space-y-4">
              <p className="section-heading">Share this list</p>

              {shareToken ? (
                <>
                  <p className="helper-text">
                    Anyone with this link can see the list and check items off (just for them, not synced back).
                  </p>
                  <input
                    type="text"
                    value={shareUrl ?? ''}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    aria-label="Share link"
                    className="input-base"
                  />
                  <div className="flex gap-2">
                    <button onClick={handleCopyLink} className="btn-primary flex-1">
                      Copy link
                    </button>
                    <button
                      onClick={handleRevokeShareLink}
                      disabled={shareBusy}
                      className="btn-secondary flex-1"
                    >
                      {shareBusy ? <Loader2 size={16} className="animate-spin" /> : 'Revoke'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="helper-text">
                    Generate a link to share this list. They'll see a read-only version — no login required.
                  </p>
                  <button
                    onClick={handleGenerateShareLink}
                    disabled={shareBusy}
                    className="btn-primary"
                  >
                    {shareBusy
                      ? <span className="flex items-center justify-center gap-2"><Loader2 size={16} className="animate-spin" /> Creating…</span>
                      : 'Generate share link'
                    }
                  </button>
                </>
              )}
            </div>
          </Sheet.Content>
        </Sheet.Container>
        <Sheet.Backdrop onTap={() => setShareSheetOpen(false)} />
      </Sheet>
    </>
  )
}
