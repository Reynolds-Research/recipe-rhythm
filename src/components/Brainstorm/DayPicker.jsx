import { useState, useEffect, useCallback } from 'react'
import { Sheet } from 'react-modal-sheet'
import { X, RefreshCw, Bookmark, Sparkles, Plus, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getRecommendations } from '../../lib/recommendations'
import {
  addScheduledItem,
  addShortlistItem,
  scheduleShortlistItem,
} from '../../lib/mealPlanWriter'
import { AI_CANDIDATE_COUNT, PICKER_VAULT_COUNT } from '../../lib/constants'

/**
 * PRD-002 P0.7 — tap-a-day → bottom-sheet picker.
 *
 * Three sections, top-to-bottom:
 *   1. From your Maybe list   — currently shortlisted items (UPDATEs the row)
 *   2. Top from your vault    — `PICKER_VAULT_COUNT` recommendations (INSERTs)
 *   3. New ideas              — `AI_CANDIDATE_COUNT` AI suggestions (INSERTs)
 *
 * Why two recommender calls instead of the merged P0.9 one: the merged call
 * sorts vault + AI into one ranked list. The picker needs them visually
 * separate so the user can tell "tested vault hit" from "fresh AI idea." We
 * call `getRecommendations` with empty wildcards for the vault batch and
 * `/api/swap-suggestions` directly for the AI batch.
 *
 * The picker's session-scoped `excludeNamesInThisSession` set grows on every
 * regenerate (so consecutive regenerates within a single open never re-show
 * the same items) and resets on close.
 *
 * @param {{
 *   date: string | null,                // 'YYYY-MM-DD'
 *   isOpen: boolean,
 *   onClose: () => void,
 *   onScheduled: () => void,            // parent refetches the meal plan
 *   userId: string,
 *   planId: string | null,              // meal_plan_id; null pre-serve
 *   vault: Array,                       // full vault items
 *   recentMeals: Array,                 // last 90d meals for recency/freq
 *   plan: Array,                        // currently scheduled items
 *   shortlist: Array,                   // currently shortlisted items
 *   preferences: Object | null,         // PRD-002 P0.3: hard-filter prefs.
 *                                       // Forwarded to getRecommendations + the
 *                                       // /api/swap-suggestions POST body. Maybe
 *                                       // section is rendered AS-IS — never
 *                                       // filtered through preferences.
 * }} props
 */
export default function DayPicker({
  date,
  isOpen,
  onClose,
  onScheduled,
  userId,
  planId,
  vault = [],
  recentMeals = [],
  plan = [],
  shortlist = [],
  preferences = null,
}) {
  const [excludeNamesInThisSession, setExcludeNamesInThisSession] = useState([])
  const [candidates, setCandidates] = useState({ maybe: [], vault: [], ai: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const scheduledNames = plan.map((p) => p.name).filter(Boolean)
  const shortlistedNames = shortlist.map((s) => s.name).filter(Boolean)

  const fetchCandidates = useCallback(
    async (sessionExcludes) => {
      setLoading(true)
      setError(null)

      const excludeForVault = [
        ...scheduledNames,
        ...shortlistedNames,
        ...sessionExcludes,
      ]
      const excludeForAi = [
        ...scheduledNames,
        ...shortlistedNames,
        ...sessionExcludes,
      ]

      // Translate excluded names into vault ids (recommender takes excludeIds).
      const excludeNamesLower = new Set(
        excludeForVault.map((n) => (n || '').trim().toLowerCase()),
      )
      const excludeIds = vault
        .filter((v) => excludeNamesLower.has((v.name || '').trim().toLowerCase()))
        .map((v) => v.id)

      const vaultRecs = getRecommendations(
        vault,
        recentMeals,
        [], // no AI mixed — picker shows AI in its own section
        PICKER_VAULT_COUNT,
        plan,
        // PRD-002 P0.3: hard-filter vault recs against household preferences.
        { excludeIds, preferences },
      )

      let aiRecs = []
      try {
        const planNames = scheduledNames.join(', ')
        const recentNames = recentMeals.slice(0, 14).map((m) => m.name).join(', ')
        const res = await fetch('/api/swap-suggestions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            planNames,
            recentNames,
            excludeNames: excludeForAi,
            count: AI_CANDIDATE_COUNT,
            // PRD-002 P0.3: forward preferences to the AI prompt; the
            // recommender post-filter is belt-and-suspenders on top of this.
            preferences,
          }),
        })
        if (res.ok) {
          const data = await res.json()
          const names = Array.isArray(data.names) ? data.names : []
          aiRecs = names.slice(0, AI_CANDIDATE_COUNT).map((name, i) => ({
            id: `ai-suggestion-${i}`,
            name,
            is_wildcard: true,
            source: 'ai',
            source_url: `https://www.allrecipes.com/search?q=${encodeURIComponent(name)}`,
          }))
        }
      } catch {
        aiRecs = []
      }

      setCandidates({ maybe: shortlist, vault: vaultRecs, ai: aiRecs })
      setLoading(false)
    },
    // The closure intentionally captures `scheduledNames` / `shortlistedNames`
    // / `plan` / `shortlist` snapshots at call time; we re-run when the sheet
    // opens or when regenerate fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vault, recentMeals, plan, shortlist, preferences],
  )

  // Open: reset session excludes and fetch fresh.
  useEffect(() => {
    if (!isOpen || !date) return
    setExcludeNamesInThisSession([])
    fetchCandidates([])
  }, [isOpen, date, fetchCandidates])

  const handleRegenerate = async () => {
    if (loading) return
    const justShownNames = [
      ...candidates.vault.map((v) => v.name),
      ...candidates.ai.map((a) => a.name),
    ].filter(Boolean)
    const nextSession = [...excludeNamesInThisSession, ...justShownNames]
    setExcludeNamesInThisSession(nextSession)
    await fetchCandidates(nextSession)
  }

  const handleSelectMaybe = async (item) => {
    if (!item?.item_id || !date) return
    setError(null)
    try {
      await scheduleShortlistItem(supabase, item.item_id, date)
      onScheduled?.()
    } catch {
      setError('Could not schedule. Try again.')
    }
  }

  const handleSelectScheduled = async (item) => {
    if (!planId || !date) {
      setError('Serve the plan first to add meals.')
      return
    }
    setError(null)
    try {
      await addScheduledItem(supabase, userId, planId, date, {
        id: item.id ?? null,
        name: item.name,
        is_wildcard: !!item.is_wildcard,
        source_url: item.source_url ?? null,
      })
      onScheduled?.()
    } catch {
      setError('Could not add meal. Try again.')
    }
  }

  const handleAddToMaybe = async (item) => {
    if (!planId) {
      setError('Serve the plan first to shortlist.')
      return
    }
    setError(null)
    try {
      await addShortlistItem(supabase, userId, planId, {
        id: item.id ?? null,
        name: item.name,
        is_wildcard: !!item.is_wildcard,
        source_url: item.source_url ?? null,
      })
      onScheduled?.()
    } catch {
      setError('Could not save to Maybe. Try again.')
    }
  }

  const headerLabel = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : ''

  const allEmpty =
    candidates.maybe.length === 0 &&
    candidates.vault.length === 0 &&
    candidates.ai.length === 0

  return (
    <Sheet
      isOpen={isOpen}
      onClose={onClose}
      snapPoints={[0, 0.7, 0.95, 1]}
      initialSnap={1}
    >
      <Sheet.Container className="!rounded-t-3xl !bg-cream-50 shadow-2xl border-t border-cream-200">
        <Sheet.Header />
        <Sheet.Content>
          <div className="px-6 py-2 pb-safe" data-testid="day-picker">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-[11px] font-bold text-brand-500 tracking-widest uppercase">
                  Schedule for
                </p>
                <p className="text-base font-serif italic text-gray-700">
                  {headerLabel}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={loading}
                  aria-label="Regenerate suggestions"
                  className="p-2 rounded-full text-brand-500 hover:bg-brand-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <RefreshCw size={16} strokeWidth={2.5} />
                  )}
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="p-2 rounded-full text-gray-500 hover:bg-cream-100 transition-colors"
                >
                  <X size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-500 text-center mb-3">{error}</p>
            )}

            <div className="max-h-[60vh] overflow-y-auto space-y-5">
              {allEmpty && !loading && (
                <div className="bg-white border border-cream-100 rounded-2xl px-5 py-6 text-center shadow-sm">
                  <p className="text-sm text-gray-500">
                    No suggestions left for this day. Try regenerating or adding a
                    recipe to your vault. Or check your preferences in Settings.
                  </p>
                </div>
              )}

              {candidates.maybe.length > 0 && (
                <section>
                  <p className="text-[11px] font-bold text-gray-400 tracking-widest mb-2 uppercase">
                    From your Maybe list
                  </p>
                  <div className="bg-white border border-cream-100 rounded-2xl divide-y divide-cream-50 shadow-sm">
                    {candidates.maybe.map((item) => (
                      <button
                        key={item.item_id}
                        onClick={() => handleSelectMaybe(item)}
                        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-cream-50 transition-colors first:rounded-t-2xl last:rounded-b-2xl"
                      >
                        <Bookmark
                          size={14}
                          strokeWidth={2}
                          className="text-brand-400 flex-shrink-0"
                          fill="currentColor"
                        />
                        <span className="text-sm font-medium text-gray-900 flex-1 truncate">
                          {item.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {candidates.vault.length > 0 && (
                <section>
                  <p className="text-[11px] font-bold text-gray-400 tracking-widest mb-2 uppercase">
                    Top from your vault
                  </p>
                  <div className="bg-white border border-cream-100 rounded-2xl divide-y divide-cream-50 shadow-sm">
                    {candidates.vault.map((item) => (
                      <CandidateRow
                        key={item.id ?? item.name}
                        item={item}
                        onSelect={handleSelectScheduled}
                        onBookmark={planId ? handleAddToMaybe : null}
                      />
                    ))}
                  </div>
                </section>
              )}

              {candidates.ai.length > 0 && (
                <section>
                  <div className="mb-2 flex items-baseline gap-2">
                    <p className="text-[11px] font-bold text-gray-400 tracking-widest uppercase">
                      New ideas
                    </p>
                    <p className="text-[10px] text-gray-400 italic">AI suggestions</p>
                  </div>
                  <div className="bg-white border border-cream-100 rounded-2xl divide-y divide-cream-50 shadow-sm">
                    {candidates.ai.map((item) => (
                      <CandidateRow
                        key={item.id ?? item.name}
                        item={{ ...item, source: 'ai' }}
                        onSelect={handleSelectScheduled}
                        onBookmark={planId ? handleAddToMaybe : null}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </Sheet.Content>
      </Sheet.Container>
      <Sheet.Backdrop onClick={onClose} />
    </Sheet>
  )
}

function CandidateRow({ item, onSelect, onBookmark }) {
  const isAi = item.source === 'ai' || item.is_wildcard
  return (
    <div className="flex items-center gap-2 px-5 py-3 first:rounded-t-2xl last:rounded-b-2xl">
      <button
        onClick={() => onSelect(item)}
        className="flex-1 flex items-center gap-2 text-left hover:text-brand-600 transition-colors min-w-0"
      >
        <Plus size={14} strokeWidth={2.5} className="text-brand-400 flex-shrink-0" />
        <span className="text-sm font-medium text-gray-900 truncate">
          {item.name}
        </span>
        {isAi && (
          <span
            data-testid="ai-new-badge"
            className="bg-brand-100 text-brand-700 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm flex items-center gap-0.5 flex-shrink-0"
          >
            <Sparkles size={8} />
            New
          </span>
        )}
      </button>
      {onBookmark && (
        <button
          onClick={() => onBookmark(item)}
          aria-label="Add to Maybe"
          title="Add to Maybe"
          className="flex-shrink-0 p-1.5 text-brand-400 hover:text-brand-600 transition-colors"
        >
          <Bookmark size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
