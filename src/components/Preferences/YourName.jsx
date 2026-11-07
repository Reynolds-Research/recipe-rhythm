import { useEffect, useId, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { loadMembers, setMyName } from '../../lib/cookNights'

/**
 * Settings → "Your name" (PRD-008 phase 3). The other person in the
 * household sees it on the nights you cook ("Matt's night"). Saved through
 * a database function that can only change your own name. Blank clears it,
 * and the other person then sees "Partner's night".
 */
export default function YourName({ userId }) {
  const inputId = useId()
  const [saved, setSaved] = useState(null)      // the name in the database
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState(null)    // 'saving' | 'saved' | 'error' | null

  useEffect(() => {
    let cancelled = false
    loadMembers(supabase, userId)
      .then((members) => {
        if (cancelled) return
        const mine = members.find((m) => m.user_id === userId)?.display_name ?? ''
        setSaved(mine)
        setDraft(mine)
      })
      .catch((err) => console.warn('[Settings] name load failed', err?.message || err))
    return () => { cancelled = true }
  }, [userId])

  const trimmed = draft.trim()
  // Until the saved name has loaded, Save stays off: saving a blank box then
  // would wipe a name that's really there.
  const unchanged = saved === null || trimmed === saved

  const save = async (e) => {
    e.preventDefault()
    if (status === 'saving' || unchanged) return
    setStatus('saving')
    try {
      const name = await setMyName(supabase, trimmed)
      setSaved(name ?? '')
      setDraft(name ?? '')
      setStatus('saved')
    } catch (err) {
      console.error('[Settings] name save failed', err)
      setStatus('error')
    }
  }

  return (
    <section aria-labelledby={`${inputId}-heading`}>
      <div className="flex items-center justify-between mb-2">
        <h2 id={`${inputId}-heading`} className="section-heading">Your name</h2>
        {status === 'saved' && <span role="status" className="text-sm font-semibold text-brand-600">Saved</span>}
      </div>
      <form onSubmit={save} className="space-y-2">
        <label htmlFor={inputId} className="helper-text block">
          Your household sees it on the nights you cook, like “Matt’s night”.
        </label>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            maxLength={30}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); if (status !== 'saving') setStatus(null) }}
            placeholder="Your first name"
            className="input-base flex-1 min-w-0"
          />
          <button type="submit" disabled={status === 'saving' || unchanged} className="btn-primary w-auto px-5 py-3 disabled:opacity-50">
            {status === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
      {status === 'error' && (
        <p role="alert" className="text-sm text-red-800 mt-2">Couldn’t save your name. Try again.</p>
      )}
    </section>
  )
}
