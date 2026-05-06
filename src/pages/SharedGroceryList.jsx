import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, ShoppingCart } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import { GROCERY_SECTIONS } from '../lib/constants'

/**
 * PRD-003 P0.9 — public read-only grocery list.
 *
 * Renders when an unauthenticated visitor hits /share/grocery/:token. Looks
 * up the list by share_token (the *_public_share RLS policies on
 * grocery_lists + grocery_list_items allow anon SELECT when share_token IS
 * NOT NULL). Renders the same section-grouped layout as GroceryListBody,
 * with one v1 simplification: check-offs are persisted in localStorage only
 * — no DB write from the public path.
 *
 * Empty / closed states:
 *   - Token returns no rows → "This list is no longer being shared." (covers
 *     revoke, typo'd URL, never-existed.)
 *   - Token resolves to a list with zero items → "This list is empty."
 *
 * No auth flow, no sign-in CTA.
 */

const STORAGE_PREFIX = 'recipe-rhythm:share-checked:'

function loadChecked(token) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + token)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function saveChecked(token, set) {
  try {
    localStorage.setItem(STORAGE_PREFIX + token, JSON.stringify([...set]))
  } catch {
    // Quota / disabled storage. Non-fatal — checks just won't persist
    // across reloads in that one browser. The list itself still renders.
  }
}

export default function SharedGroceryList() {
  const { token } = useParams()
  // Initialize loading/checked synchronously so useEffect never needs to
  // call setState unconditionally — avoids the react-hooks/set-state-in-effect
  // lint error from synchronous setState in effect bodies.
  const [loading, setLoading] = useState(() => Boolean(token))
  const [list, setList]       = useState(null)
  const [items, setItems]     = useState([])
  const [checked, setChecked] = useState(() => token ? loadChecked(token) : new Set())

  useEffect(() => {
    if (!token) {
      return
    }

    let cancelled = false
    ;(async () => {
      const { data: listRow, error: listErr } = await supabase
        .from('grocery_lists')
        .select('id')
        .eq('share_token', token)
        .maybeSingle()

      if (cancelled) return
      if (listErr || !listRow) {
        setList(null)
        setLoading(false)
        return
      }
      setList(listRow)

      const { data: itemRows, error: itemsErr } = await supabase
        .from('grocery_list_items')
        .select('id, name, quantity, section')
        .eq('list_id', listRow.id)
        .order('created_at', { ascending: true })

      if (cancelled) return
      if (itemsErr) {
        console.error('[SharedGroceryList] items fetch failed:', itemsErr.message)
        setItems([])
      } else {
        setItems(itemRows ?? [])
      }
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [token])

  const toggle = (id) => {
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveChecked(token, next)
      return next
    })
  }

  if (loading) {
    return (
      <div className="mobile-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-500" size={28} />
      </div>
    )
  }

  if (!list) {
    return (
      <div className="mobile-screen pb-28">
        <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
          <Logo className="w-8 h-8 mb-2" />
          <p className="text-lg text-gray-900 mt-1 font-serif italic">Grocery List</p>
        </div>
        <div className="px-5 py-16 text-center space-y-2">
          <ShoppingCart size={32} className="mx-auto text-gray-500" />
          <p className="body-text">This list is no longer being shared.</p>
          <p className="helper-text">Ask the planner for a new link.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">Grocery List</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">For My Wife</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {items.length === 0 ? (
          <div className="text-center py-16 space-y-2">
            <ShoppingCart size={32} className="mx-auto text-gray-500" />
            <p className="body-text">This list is empty.</p>
          </div>
        ) : (
          <div className="space-y-5">
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
                    {sectionItems.map(item => {
                      const isChecked = checked.has(item.id)
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => toggle(item.id)}
                            aria-pressed={isChecked}
                            className="flex items-baseline justify-between gap-3 py-1 w-full text-left"
                          >
                            <span className={`body-text ${isChecked ? 'line-through text-gray-500' : ''}`}>
                              {item.name}
                            </span>
                            {item.quantity && (
                              <span className={`helper-text shrink-0 ${isChecked ? 'line-through text-gray-500' : ''}`}>
                                {item.quantity}
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
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
