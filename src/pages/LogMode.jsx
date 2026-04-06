import { useState, useEffect } from 'react'
import { Mic, MicOff, Check } from 'lucide-react'
import { useSpeech } from '../hooks/useSpeech'
import { supabase } from '../lib/supabase'

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

    // Success — show confirmation, reset form
    setSaved(true)
    setEditableText('')
    setNote('')
    setTranscript('')
    onSave?.()

    setTimeout(() => setSaved(false), 2500)
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()

  return (
    <div className="mobile-screen">

      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 px-5 py-4 text-center">
        <p className="text-xs text-gray-400 tracking-widest">{today} · LOG MODE</p>
        <p className="text-lg font-medium text-gray-900 mt-1">What did you eat tonight?</p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

        {/* Recents shelf */}
        {recentMeals.length > 0 && (
          <div>
            <p className="text-xs font-medium text-gray-400 tracking-widest mb-2">RECENT</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recentMeals.map((meal) => (
                <button
                  key={meal.id}
                  onClick={() => setEditableText(meal.name)}
                  className="flex-shrink-0 bg-gray-50 border border-gray-200 rounded-full px-4 py-1.5 text-sm text-gray-600 whitespace-nowrap active:bg-brand-50 transition-colors"
                >
                  {meal.name}
                </button>
              ))}
            </div>
          </div>
        )}

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

        {/* Save confirmation */}
        {saved && (
          <div className="flex items-center justify-center gap-2 bg-green-50 border border-green-200 rounded-2xl py-3">
            <Check size={16} className="text-green-600" />
            <span className="text-sm font-medium text-green-700">Logged!</span>
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
              <span className="absolute inset-0 rounded-full bg-brand-100 animate-ping opacity-60" />
            )}
            <button
              onClick={toggleListening}
              className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-colors
                ${isListening
                  ? 'bg-brand-100 border border-brand-300'
                  : 'bg-brand-50 border border-brand-200'
                }`}
            >
              {isListening
                ? <MicOff size={24} className="text-brand-600" />
                : <Mic    size={24} className="text-brand-600" />
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
