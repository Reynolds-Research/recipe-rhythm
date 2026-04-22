import { useState, useEffect, useRef } from 'react'

/**
 * useSpeech
 * A custom React hook that wraps the Web Speech API.
 * Returns the transcript, listening state, and start/stop controls.
 */
export function useSpeech() {
  const [transcript, setTranscript]   = useState('')
  const [isListening, setIsListening] = useState(false)
  const [error, setError]             = useState(null)
  const recognitionRef                = useRef(null)

  useEffect(() => {
    // Browser compatibility: Safari uses the webkit prefix
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('Speech recognition is not supported in this browser.')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang            = 'en-US'
    recognition.interimResults  = false   // wait for full sentence, not live words
    recognition.continuous      = false   // stop after one utterance

    recognition.onresult = (event) => {
      const result = event.results[0][0].transcript
      setTranscript(result)
      setIsListening(false)
    }

    recognition.onerror = (event) => {
      setError(`Mic error: ${event.error}`)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
  }, [])

  const startListening = () => {
    if (!recognitionRef.current) return
    setError(null)
    setTranscript('')
    recognitionRef.current.start()
    setIsListening(true)
  }

  const stopListening = () => {
    if (!recognitionRef.current) return
    recognitionRef.current.stop()
    setIsListening(false)
  }

  const toggleListening = () => {
    isListening ? stopListening() : startListening()
  }

  return { transcript, isListening, error, toggleListening, setTranscript }
}
