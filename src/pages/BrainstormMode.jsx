import { useState, useEffect } from 'react'
import { Share2, RefreshCw, GripVertical, Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { getRecommendations } from '../lib/recommendations'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  TouchSensor,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * BrainstormMode
 * The Sat–Sun planning screen.
 * Shows last week's meals, then a suggested Sun–Thu menu.
 * Each suggestion can be swapped from a Vault picker sheet.
 */

const PLAN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']

function SortableMealItem({ slot, onSwap }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: slot.day })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-4 py-4 bg-white ${
        isDragging ? 'opacity-50 shadow-lg relative rounded-xl border-brand-200' : ''
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-brand-400 p-1"
      >
        <GripVertical size={18} strokeWidth={2} />
      </div>
      <span className="text-[10px] font-bold text-brand-400 w-8 flex-shrink-0 tracking-tighter uppercase">
        {slot.day}
      </span>
      <span className="text-sm flex-1 text-gray-900 font-medium leading-snug flex items-center gap-2">
        {slot.name}
        {slot.is_wildcard && (
          <span className="bg-brand-100 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm flex items-center gap-0.5">
            <Sparkles size={8} />
            Wildcard
          </span>
        )}
      </span>
      <button
        onClick={() => onSwap(slot.day)}
        className="flex-shrink-0 text-[10px] font-bold text-brand-600 bg-brand-50 border border-brand-100 rounded-full px-3.5 py-1.5 uppercase tracking-wide hover:bg-brand-100 transition-colors"
      >
        Swap
      </button>
    </div>
  )
}

export default function BrainstormMode() {
  const [lastWeek, setLastWeek] = useState([])   // what was eaten last week
  const [plan, setPlan] = useState([])   // suggested Sun–Thu meals
  const [vault, setVault] = useState([])   // all vault items for the picker
  const [swapDay, setSwapDay] = useState(null) // which day's picker is open
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    })
  )

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
      name:        suggestions[i]?.name || 'Add meals to your Vault to get suggestions',
      id:          suggestions[i]?.id || null,
      is_wildcard: suggestions[i]?.is_wildcard || false,
    }))
  }

  // Swap a day's suggestion with a vault pick
  const handleSwap = (day, vaultItem) => {
    setPlan(prev =>
      prev.map(slot =>
        slot.day === day
          ? { ...slot, name: vaultItem.name, id: vaultItem.id, is_wildcard: vaultItem.is_wildcard || false }
          : slot
      )
    )
    setSwapDay(null)
  }

  const handleDragEnd = (event) => {
    const { active, over } = event

    if (active.id !== over.id) {
      setPlan((items) => {
        const oldIndex = items.findIndex((item) => item.day === active.id)
        const newIndex = items.findIndex((item) => item.day === over.id)

        // We want to keep the days (Sun, Mon, etc.) fixed in order, 
        // but swap the meal *names* and *ids* at those indices.
        const newPlan = [...items]
        const movedItem = { ...items[oldIndex] }
        const targetItem = { ...items[newIndex] }

        // Actually, dnd-kit usually reorders the entire object.
        // If we want to keep DAYS fixed, we just swap the meal data.
        const reorderedMeals = arrayMove(items.map(i => ({ name: i.name, id: i.id, is_wildcard: i.is_wildcard })), oldIndex, newIndex)
        
        return items.map((item, index) => ({
          ...item,
          name:        reorderedMeals[index].name,
          id:          reorderedMeals[index].id,
          is_wildcard: reorderedMeals[index].is_wildcard,
        }))
      })
    }
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
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-4 text-center">
        <p className="text-[10px] text-brand-600 font-bold tracking-[0.2em]">BRAINSTORM MODE</p>
        <p className="text-xl font-medium text-gray-900 mt-1.5 font-serif italic">Plan next week</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Last week's meals */}
        <div>
          <p className="text-[10px] font-bold text-gray-400 tracking-[0.2em] mb-3 uppercase">LAST WEEK</p>
          <div className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm">
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold text-gray-400 tracking-[0.2em] uppercase">SUGGESTED · SUN–THU</p>
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 text-[10px] font-bold text-brand-500 uppercase tracking-wider hover:text-brand-600 transition-colors"
            >
              <RefreshCw size={12} strokeWidth={2.5} />
              Regenerate
            </button>
          </div>
          <div className="bg-white border border-cream-100 rounded-2xl px-5 shadow-sm overflow-hidden">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={plan.map(s => s.day)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-cream-50">
                  {plan.map((slot) => (
                    <SortableMealItem
                      key={slot.day}
                      slot={slot}
                      onSwap={setSwapDay}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
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
            className="w-full bg-cream-50 rounded-t-3xl px-6 py-6 shadow-2xl border-t border-cream-200"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-[10px] font-bold text-brand-500 tracking-[0.2em] mb-1 uppercase">
              SWAP {swapDay.toUpperCase()}
            </p>
            <p className="text-base font-serif italic text-gray-700 mb-6">Pick from your vault</p>

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
