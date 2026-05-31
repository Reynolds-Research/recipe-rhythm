import { useEffect, useState } from 'react'
import { Sparkles, ExternalLink, CalendarPlus, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fetchCurrentLeftovers } from '../lib/mealPlanReader'
import Logo from './Logo'

// Format 'YYYY-MM-DD' → "Apr 12". We parse in UTC so the displayed date
// matches the stored calendar date regardless of the browser's local offset
// (mirrors the AUDIT U8 discipline used by mealPlanReader).
function formatShortDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * GapDayView
 *
 * The read-side surface shown when classifyPlanState(plan) === 'gap'.
 * Renders last period's end date, the list of actionable leftovers from the
 * current_leftovers view, and a CTA that hands control back to the parent
 * (BrainstormMode) to open the new-period flow.
 *
 * @param {{
 *   userId: string,
 *   periodEnd: string | null,
 *   onStartNewPeriod: () => void,
 * }} props
 */
export default function GapDayView({ userId, periodEnd, onStartNewPeriod }) {
  // Tri-state in one object so we don't need to call multiple setters at the
  // start of the effect (which eslint react-hooks/set-state-in-effect flags).
  const [state, setState] = useState({
    status: 'loading',
    leftovers: [],
    error: null,
  })
  const { status, leftovers, error } = state
  const loading = status === 'loading'

  useEffect(() => {
    let cancelled = false
    fetchCurrentLeftovers(supabase, userId)
      .then((rows) => {
        if (!cancelled) setState({ status: 'ready', leftovers: rows, error: null })
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'ready', leftovers: [], error: err })
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  if (loading) {
    return (
      <div className="mobile-screen items-center justify-center pb-28">
        <p className="helper-text">Checking for leftovers…</p>
      </div>
    )
  }

  return (
    <div className="mobile-screen pb-28">
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-700 font-bold tracking-widest uppercase">
          For My Wife
        </h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">
          Between periods
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        <div className="text-center">
          <p className="body-text">
            Your last period ended{' '}
            <span className="font-semibold text-gray-900">
              {periodEnd ? formatShortDate(periodEnd) : 'recently'}
            </span>
            .
          </p>
        </div>

        {error && (
          <p className="text-xs text-red-600 text-center">
            Couldn't load leftovers. Try reloading.
          </p>
        )}

        {leftovers.length > 0 ? (
          <div>
            <p className="section-heading mb-3">Leftovers from last period</p>
            <div
              className="bg-white border border-cream-100 rounded-2xl px-5 divide-y divide-cream-50 shadow-sm"
              data-testid="gap-leftover-list"
            >
              {leftovers.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 py-3"
                  data-testid="gap-leftover-item"
                >
                  <span className="text-sm font-bold text-brand-700 w-14 shrink-0 tracking-tighter uppercase">
                    {formatShortDate(item.scheduled_date)}
                  </span>
                  <span className="text-base flex-1 text-gray-900 font-medium leading-snug flex items-center gap-2">
                    {item.name}
                    {item.is_wildcard && (
                      <div className="flex items-center gap-2">
                        <span className="bg-brand-100 text-brand-700 text-xs font-bold px-2 py-1 rounded uppercase tracking-tighter shadow-sm flex items-center gap-1">
                          <Sparkles size={10} />
                          New
                        </span>
                        {item.source_url && (
                          <a
                            href={item.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-700 hover:text-brand-800 transition-colors"
                            title="View Recipe"
                            aria-label={`View recipe for ${item.name}`}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="bg-white border border-cream-100 rounded-2xl px-5 py-6 text-center shadow-sm"
            data-testid="gap-no-leftovers"
          >
            <p className="text-base text-gray-700 font-serif italic">
              Nothing left over — start fresh.
            </p>
          </div>
        )}

        <button
          onClick={onStartNewPeriod}
          className="btn-primary flex items-center justify-center gap-2"
          data-testid="start-new-period-btn"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Loading…
            </>
          ) : (
            <>
              <CalendarPlus size={16} />
              Start a new planning period
            </>
          )}
        </button>
      </div>
    </div>
  )
}
