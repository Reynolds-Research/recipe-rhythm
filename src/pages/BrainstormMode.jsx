import { useState, useEffect } from 'react'
import { Share2, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getRecommendations } from '../lib/recommendations'

/**
 * BrainstormMode
 * The Sat–Sun planning screen.
 * Shows last week's meals, then a suggested Sun–Thu menu.
 * Each suggestion can be swapped from a Vault picker sheet.
 */

const PLAN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']

export default function BrainstormMode() {
  const [lastWeek, setLastWeek] = useState([])   // what was eaten last week
  const [plan, setPlan] = useState([])   // suggested Sun–Thu meals
  const [vault, setVault] = useState([])   // all vault items for the picker
  const [swapDay, setSwapDay] = useState(null) // which day's picker is open
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    loadData()
  }, [])
  const fetchWildcards = async (recentMeals) => {
    const key = import.meta.env.VITE_SPOONACULAR_KEY
    if (!key) return []

    // Build a list of cuisines eaten recently so we can ask for something different
    const recentCuisines = [...new Set(
      recentMeals.map(m => m.cuisine_type).filter(Boolean)
    )].join(',')

    try {
      const url = new URL('https://api.spoonacular.com/recipes/random')
      url.searchParams.set('apiKey', key)
      url.searchParams.set('number', '3')
      if (recentCuisines) {
        url.searchParams.set('tags', recentCuisines)
      }

      const res = await fetch(url)
      const data = await res.json()

      // Map Spoonacular's shape to match our vault item shape
      return (data.recipes || []).map(r => ({
        id: `wildcard-${r.id}`,
        name: r.title,
        is_wildcard: true,
        source_url: r.sourceUrl,
      }))
    } catch (e) {
      console.error('Spoonacular fetch failed:', e)
      return []  // fail silently — vault suggestions still work fine
    }
  }
  const loadData = async () => {
    setLoading(true)

    // Get meals from the last 14 days for the recency filter
    const twoWeeksAgo = new Date()
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)

    const [mealsRes, vaultRes] = await Promise.all([
      supabase
        .from('meals')
        .select('id, name, cuisine_type, flavor_profile, vault_id, eaten_on')
        .gte('eaten_on', twoWeeksAgo.toISOString().split('T')[0])
        .order('eaten_on', { ascending: false }),
      supabase
        .from('vault')
        .select('id, name, cuisine_type, flavor_profile, is_wildcard')
        .order('created_at', { ascending: false }),
    ])

    const recentMeals = mealsRes.data || []
    const vaultItems = vaultRes.data || []

    setVault(vaultItems)

    // Last week = meals from the past 7 days, mapped to Mon–Fri slots
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const lastWeekMeals = recentMeals.filter(
      m => new Date(m.eaten_on) >= sevenDaysAgo
    )
    setLastWeek(buildLastWeekSlots(lastWeekMeals))

    // Generate the Sun–Thu plan using the recommendation engine
    const wildcards = await fetchWildcards(recentMeals)
    const suggestions = getRecommendations(vaultItems, recentMeals, wildcards, 5)
    setPlan(buildPlan(suggestions))

    setLoading(false)
  }

  /**
   * Maps logged meals onto Mon–Fri day slots for the "last week" section.
   * Days with no logged meal show a dash.
   */
  function buildLastWeekSlots(meals) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    return days.map(day => {
      const match = meals.find(m => {
        const d = new Date(m.eaten_on)
        return d.toLocaleDateString('en-US', { weekday: 'short' }) === day
      })
      return { day, name: match?.name || null }
    })
  }

  /**
   * Pairs each suggestion with a plan day label (Sun–Thu).
   * If the vault is empty, fills with placeholder text.
   */
  function buildPlan(suggestions) {
    return PLAN_DAYS.map((day, i) => ({
      day,
      name: suggestions[i]?.name || 'Add meals to your Vault to get suggestions',
      id: suggestions[i]?.id || null,
    }))
  }

  // Swap a day's suggestion with a vault pick
  const handleSwap = (day, vaultItem) => {
    setPlan(prev =>
      prev.map(slot =>
        slot.day === day
          ? { ...slot, name: vaultItem.name, id: vaultItem.id }
          : slot
      )
    )
    setSwapDay(null)
  }

  // Share the plan using the native mobile share sheet
  const handleShare = async () => {
    const text = [
      'Meal plan for the week:',
      '',
      ...plan.map(slot => `${slot.day}: ${slot.name}`),
    ].join('\n')

    if (navigator.share) {
      setSharing(true)
      try {
        await navigator.share({ title: 'Meal plan', text })
      } catch (e) {
        // User dismissed the share sheet — not an error
      }
      setSharing(false)
    } else {
      // Fallback for desktop browsers that don't support navigator.share
      await navigator.clipboard.writeText(text)
      alert('Plan copied to clipboard!')
    }
  }

  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <p className="text-sm text-gray-400">Building your plan…</p>
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">

      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-5 py-4 text-center">
        <p className="text-xs text-gray-400 tracking-widest">BRAINSTORM MODE</p>
        <p className="text-lg font-medium text-gray-900 mt-1">Plan next week</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Last week's meals */}
        <div>
          <p className="text-xs font-medium text-gray-400 tracking-widest mb-2">LAST WEEK</p>
          <div className="bg-gray-50 rounded-2xl px-4 divide-y divide-gray-100">
            {lastWeek.map(({ day, name }) => (
              <div key={day} className="flex items-center gap-3 py-3">
                <span className="text-xs font-medium text-gray-400 w-8 flex-shrink-0">{day.toUpperCase()}</span>
                <span className={`text-sm flex-1 ${name ? 'text-gray-900' : 'text-gray-300'}`}>
                  {name || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Suggested plan */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-gray-400 tracking-widest">SUGGESTED · SUN–THU</p>
            <button
              onClick={loadData}
              className="flex items-center gap-1 text-xs text-brand-600"
            >
              <RefreshCw size={12} />
              Regenerate
            </button>
          </div>
          <div className="bg-gray-50 rounded-2xl px-4 divide-y divide-gray-100">
            {plan.map(({ day, name }) => (
              <div key={day} className="flex items-center gap-3 py-3">
                <span className="text-xs font-medium text-gray-400 w-8 flex-shrink-0">{day.toUpperCase()}</span>
                <span className="text-sm flex-1 text-gray-900">{name}</span>
                <button
                  onClick={() => setSwapDay(day)}
                  className="flex-shrink-0 text-xs text-brand-600 bg-brand-50 border border-brand-200 rounded-full px-3 py-1"
                >
                  Swap
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Share button */}
        <button
          onClick={handleShare}
          disabled={sharing}
          className="btn-primary flex items-center justify-center gap-2"
        >
          <Share2 size={16} />
          {sharing ? 'Sharing…' : 'Share plan via text'}
        </button>

      </div>

      {/* Swap picker — bottom sheet */}
      {swapDay && (
        <div
          className="absolute inset-0 bg-black/40 z-50 flex items-end"
          onClick={() => setSwapDay(null)}
        >
          <div
            className="w-full bg-white rounded-t-3xl px-5 py-5"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-xs font-medium text-gray-400 tracking-widest mb-1">
              SWAP {swapDay.toUpperCase()}
            </p>
            <p className="text-sm text-gray-500 mb-4">Pick from your vault</p>

            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {vault.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">
                  Your vault is empty — save some recipes first
                </p>
              ) : (
                vault.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleSwap(swapDay, item)}
                    className="w-full text-left py-3 text-sm text-gray-900 hover:text-brand-600 transition-colors"
                  >
                    {item.name}
                  </button>
                ))
              )}
            </div>

            <button
              onClick={() => setSwapDay(null)}
              className="w-full mt-4 py-3 rounded-2xl border border-gray-200 text-sm text-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
