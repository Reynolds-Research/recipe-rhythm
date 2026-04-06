import { useState, useEffect } from 'react'
import { Mic, MicOff, Check, BookOpen } from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { supabase } from '../lib/supabase'
import { analyzeRecipe } from '../lib/analyzeRecipe'

/**
 * LogMode
 * The Mon–Fri screen. Low friction meal logging with voice-first input.
 */
export default function LogMode({ recentMeals = [], onSave }) {
  const { transcript, isListening, error, toggleListening, setTranscript } = useSpeech()
  const [editableText, setEditableText] = useState('')
  const [note, setNote]                 = useState('')
  const [saved, setSaved]               = useState(false)
  const [saving, setSaving]             = useState(false)
  const [savedMealName, setSavedMealName] = useState('')
  const [savedMealNote, setSavedMealNote] = useState('')

  // When the speech hook gives us a transcript, drop it into the editable box
  useEffect(() => {
    if (transcript) setEditableText(transcript)
  }, [transcript])

  const handleSave = async () => {
    if (!editableText.trim()) return
    setSaving(true)

    const { error: dbError } = await supabase.from('meals').insert({
      name:    editableText.trim(),
      notes:   note.trim() || null,
      eaten_on: new Date().toISOString().split('T')[0], // today's date: YYYY-MM-DD
    })

    setSaving(false)

    if (dbError) {
      console.error('Save failed:', dbError.message)
      return
    }

    // Check if it's already in the vault before offering to save it
    const { data: existing } = await supabase
      .from('vault')
      .select('id')
      .ilike('name', editableText.trim())
      .limit(1)

    // Success — show confirmation, reset form
    setSaved(true)
    if (!existing || existing.length === 0) {
      setSavedMealName(editableText.trim())
      setSavedMealNote(note.trim())
    }
    setEditableText('')
    setNote('')
    setTranscript('')
    onSave?.()

    setTimeout(() => {
      setSaved(false)
      setSavedMealName('')
      setSavedMealNote('')
    }, 4000)
  }

  const handleSaveToVault = async () => {
    if (!savedMealName) return
    const analysis = await analyzeRecipe(savedMealName)
    await supabase.from('vault').insert({
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
    setSavedMealName('')
    setSavedMealNote('')
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()

  return (
    <div className="mobile-screen">

      {/* Header */}
      <div className="bg-cream-100/30 border-b border-cream-100 px-5 py-4 text-center">
        <p className="text-[10px] text-brand-600 font-bold tracking-[0.2em]">{today} · LOG MODE</p>
        <p className="text-xl font-medium text-gray-900 mt-1.5 font-serif italic">What did you eat tonight?</p>
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
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-2xl py-3">
              <Check size={16} className="text-green-600" />
              <span className="text-sm font-medium text-green-700">Logged!</span>
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
      <div className="px-5 py-4 border-t border-gray-100 space-y-3">

        {/* Mic button */}
        <div className="flex justify-center">
          <div className="relative">
            {/* Pulse ring — only visible when listening */}
            {isListening && (
              <span className="absolute inset-0 rounded-full bg-brand-200 animate-ping opacity-40" />
            )}
            <button
              onClick={toggleListening}
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
    </div>
  )
}
