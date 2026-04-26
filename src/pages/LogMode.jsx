import { useState, useEffect } from 'react'
import { Mic, MicOff, Check, BookOpen, MessageSquare, X } from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { supabase } from '../lib/supabase'
import { analyzeRecipe } from '../lib/analyzeRecipe'
import { matchVaultByName } from '../lib/vaultMatch'
import Logo from '../components/Logo'
import VaultMatchSheet from '../components/VaultMatchSheet'
import { useHaptics } from '../hooks/useHaptics'

/**
 * LogMode
 * The Mon–Fri screen. Low friction meal logging with voice-first input.
 */
export default function LogMode({ recentMeals = [], onSave, userId }) {
  const { transcript, isListening, error, toggleListening, setTranscript } = useSpeech()
  const { trigger } = useHaptics()
  const [editableText, setEditableText] = useState('')
  const [note, setNote]                 = useState('')
  const [saved, setSaved]               = useState(false)
  const [saving, setSaving]             = useState(false)
  const [savedMealName, setSavedMealName] = useState('')
  const [savedMealNote, setSavedMealNote] = useState('')

  // Disambiguation sheet state — opened when matchVaultByName finds >1 candidate.
  // pendingSave holds the {name, note} captured at Save time so the sheet's
  // selection can complete the insert with the user's chosen vault_id.
  const [sheetOpen, setSheetOpen]           = useState(false)
  const [pendingMatches, setPendingMatches] = useState([])
  const [pendingSave, setPendingSave]       = useState(null)

  // When the speech hook gives us a transcript, drop it into the editable box
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (transcript) setEditableText(transcript)
  }, [transcript])

  // Insert the meal row, reset form, and surface the Save-to-Cookbook prompt
  // when no vault link was resolved. Called from both the inline save path
  // (0 or 1 match) and the sheet's onSelect (multi-match disambiguation).
  const finalizeSave = async (finalName, finalNote, resolvedVaultId) => {
    setSaving(true)

    const { error: dbError } = await supabase
      .from('meals')
      .insert({
        user_id:  userId,
        name:     finalName,
        notes:    finalNote || null,
        eaten_on: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        vault_id: resolvedVaultId,
      })

    setSaving(false)

    if (dbError) {
      console.error('Save failed:', dbError.message)
      return
    }

    setSaved(true)
    // Only offer Save-to-Cookbook when there's no existing vault link.
    if (!resolvedVaultId) {
      setSavedMealName(finalName)
      setSavedMealNote(finalNote)
    } else {
      setSavedMealName('')
      setSavedMealNote('')
    }
    setEditableText('')
    setNote('')
    setTranscript('')
    onSave?.()
  }

  const handleSave = async () => {
    const finalName = editableText.trim()
    if (!finalName) return
    trigger('success')
    setSaving(true)

    const finalNote = note.trim()
    const { matches } = await matchVaultByName(supabase, userId, finalName)

    if (matches.length > 1) {
      // Hand off to the disambiguation sheet — it'll call back with the chosen id.
      setPendingSave({ name: finalName, note: finalNote })
      setPendingMatches(matches)
      setSheetOpen(true)
      setSaving(false)
      return
    }

    const resolvedVaultId = matches.length === 1 ? matches[0].id : null
    await finalizeSave(finalName, finalNote, resolvedVaultId)
  }

  const handleSheetSelect = async (vaultId) => {
    // vaultId is null when the user picked "None of these".
    setSheetOpen(false)
    if (!pendingSave) return
    const { name, note: pendingNote } = pendingSave
    setPendingSave(null)
    setPendingMatches([])
    await finalizeSave(name, pendingNote, vaultId)
  }

  const handleSheetClose = () => {
    // Treat dismiss (backdrop/swipe) the same as "None of these" — the user
    // explicitly tapped Save, so we honor the intent and log without a link
    // rather than silently dropping the meal.
    handleSheetSelect(null)
  }

  const handleSaveToVault = async () => {
    if (!savedMealName) return
    const analysis = await analyzeRecipe(savedMealName)
    const { data: newVault, error: insertErr } = await supabase
      .from('vault')
      .insert({
        user_id:          userId,
        name:             savedMealName,
        is_wildcard:      false,
        auto_completed:   true,
        notes:            savedMealNote             || null,
        cuisine_type:     analysis?.cuisine_type     ?? null,
        flavor_profile:   analysis?.flavor_profile   ?? null,
        proteins:         analysis?.proteins         ?? [],
        cooking_method:   analysis?.cooking_method   ?? null,
        main_carb:        analysis?.main_carb        ?? null,
        dietary_tags:     analysis?.dietary_tags     ?? [],
        dairy_components: analysis?.dairy_components ?? [],
        vegetables:       analysis?.vegetables       ?? [],
        fruits:           analysis?.fruits           ?? [],
      })
      .select('id')
      .single()

    // PRD-001 OQ.B: back-link only the most recent matching meal whose
    // vault_id is still NULL. Aggressive backfill across history is a future
    // P1 item — we don't want to clobber pre-existing links the user may
    // have set deliberately, and the recommendation engine only needs recent
    // signal to start working.
    if (!insertErr && newVault?.id) {
      await supabase
        .from('meals')
        .update({ vault_id: newVault.id })
        .eq('user_id', userId)
        .ilike('name', savedMealName)
        .is('vault_id', null)
        .order('created_at', { ascending: false })
        .limit(1)
    }

    setSavedMealName('')
    setSavedMealNote('')
    setSaved(false)
  }

  const todayHour = new Date().getHours()
  const timeAwareString = todayHour < 11 
    ? 'What did you eat last night?' 
    : 'What did you eat tonight?'



  return (
    <div className="mobile-screen">

      {/* Header */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-5 text-center flex flex-col items-center">
        <Logo className="w-8 h-8 mb-2" />
        <h1 className="text-sm text-brand-600 font-bold tracking-widest uppercase">For My Wife</h1>
        <p className="text-lg text-gray-900 mt-1 font-serif italic">{timeAwareString}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 pb-28">

        {/* Recents shelf */}
        {recentMeals.length > 0 && (() => {
          // Remove duplicates (case-insensitive) and limit to 6 items to give 4-5 visible comfortably
          const uniqueMeals = recentMeals.reduce((acc, meal) => {
            if (!acc.find(m => m.name.toLowerCase().trim() === meal.name.toLowerCase().trim())) {
              acc.push(meal)
            }
            return acc
          }, []).slice(0, 6)

          return (
            <div>
              <p className="text-xs font-medium text-gray-400 tracking-widest mb-2">RECENT</p>
              <div className="flex flex-wrap gap-2 pb-1">
                {uniqueMeals.map((meal) => (
                  <button
                    key={meal.id}
                    onClick={() => setEditableText(meal.name)}
                    className="bg-white border border-cream-200 rounded-full px-4 py-1.5 text-sm text-gray-600 whitespace-normal text-left leading-tight active:bg-brand-50 active:border-brand-200 transition-all font-medium max-w-full"
                  >
                    {meal.name}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Editable transcript box */}
        <div>
          <textarea
            value={editableText}
            onChange={(e) => setEditableText(e.target.value)}
            placeholder="Tap the mic and speak, or type here…"
            rows={3}
            className="input-base resize-none leading-relaxed"
          />
        </div>

        {/* Optional note */}
        <div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note… (e.g. more lime next time)"
            className="input-base"
          />
        </div>

        {/* Error message */}
        {error && (
          <p className="text-xs text-red-500 text-center">{error}</p>
        )}

        {/* Save confirmation + vault prompt */}
        {saved && (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-2xl py-3 px-4">
              <div className="flex items-center gap-2">
                <Check size={16} className="text-green-600" />
                <span className="text-sm font-medium text-green-700">Logged!</span>
              </div>
              <button 
                onClick={() => setSaved(false)} 
                className="text-green-600/60 hover:text-green-800 transition-colors"
                aria-label="Dismiss message"
              >
                <X size={16} />
              </button>
            </div>
            {savedMealName && (
              <button
                onClick={handleSaveToVault}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-brand-200 bg-brand-50 text-sm font-medium text-brand-600 transition-colors hover:bg-brand-100"
              >
                <BookOpen size={14} />
                Save "{savedMealName}" to Cookbook
              </button>
            )}
          </div>
        )}
      </div>

      {/* Mic button + Save — pinned to bottom */}
      <div className="relative px-5 py-4 border-t border-gray-100 space-y-3">

        {/* Feedback Link */}
        <a
          href="mailto:mreynolds08@gmail.com?subject=Recipe%20Rhythm%20Feedback"
          className="absolute top-8 left-5 text-gray-300 hover:text-gray-500 transition-colors p-2 -ml-2"
          title="Submit feedback or report a bug"
          aria-label="Submit feedback or report a bug"
        >
          <MessageSquare size={18} />
        </a>

        {/* Mic button */}
        <div className="flex justify-center">
          <div className="relative">
            {/* Pulse ring — only visible when listening */}
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-brand-200 animate-ping opacity-40" />
            )}
            <button
              onClick={toggleListening}
              aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg
                ${isListening
                  ? 'bg-brand-500 scale-110 shadow-brand-200'
                  : 'bg-white border border-brand-100 hover:border-brand-200'
                }`}
            >
              {isListening
                ? <MicOff size={28} className="text-white" />
                : <Mic    size={28} className="text-brand-500" />
              }
            </button>
          </div>
        </div>

        <p className="text-xs text-gray-400 text-center">
          {isListening ? 'Tap to stop' : 'Tap to start'}
        </p>

        <button
          onClick={handleSave}
          disabled={!editableText.trim() || saving}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save to log'}
        </button>

      </div>

      <VaultMatchSheet
        isOpen={sheetOpen}
        matches={pendingMatches}
        mealName={pendingSave?.name ?? ''}
        onSelect={handleSheetSelect}
        onClose={handleSheetClose}
      />
    </div>
  )
}
